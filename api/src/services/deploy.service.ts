import { spawn, execSync } from 'child_process';
import { logger } from '../utils/logger';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface VercelDeployOptions {
  token: string;
  projectName: string;
  framework: string;
  rootDirectory?: string;
  envVars?: Record<string, string>;
}

interface VPSDeployOptions {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  repoUrl: string;
  branch?: string;
  projectDir: string;
  envVars?: Record<string, string>;
  nodeVersion?: string;
}

interface DeployEvent {
  type: 'log' | 'error' | 'success' | 'progress';
  message: string;
  timestamp: string;
  stage?: string;
}

type EventCallback = (event: DeployEvent) => void;

export class DeployService {
  private static subscribers: Map<string, EventCallback[]> = new Map();

  static subscribe(deployId: string, callback: EventCallback) {
    if (!this.subscribers.has(deployId)) {
      this.subscribers.set(deployId, []);
    }
    this.subscribers.get(deployId)!.push(callback);
    return () => {
      const list = this.subscribers.get(deployId);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private static emit(deployId: string, event: DeployEvent) {
    const list = this.subscribers.get(deployId);
    if (list) {
      for (const cb of list) cb(event);
    }
  }

  static async deployToVercel(options: VercelDeployOptions, deployId: string): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const { token, projectName, framework, rootDirectory, envVars } = options;

      this.emit(deployId, { type: 'log', message: 'Starting Vercel deployment...', timestamp: new Date().toISOString(), stage: 'init' });

      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

      this.emit(deployId, { type: 'progress', message: 'Creating Vercel project...', timestamp: new Date().toISOString(), stage: 'create-project' });

      let projectId: string;
      try {
        const existing = await axios.get(`https://api.vercel.com/v9/projects?name=${projectName}`, { headers });
        const match = existing.data.projects?.find((p: any) => p.name === projectName);
        if (match) {
          projectId = match.id;
          this.emit(deployId, { type: 'log', message: `Found existing project: ${projectName}`, timestamp: new Date().toISOString(), stage: 'create-project' });
        } else {
          const created = await axios.post('https://api.vercel.com/v9/projects', {
            name: projectName,
            framework,
            rootDirectory,
            gitRepository: { type: 'github', repo: projectName },
          }, { headers });
          projectId = created.data.id;
          this.emit(deployId, { type: 'log', message: `Created project: ${projectName}`, timestamp: new Date().toISOString(), stage: 'create-project' });
        }
      } catch (err: any) {
        this.emit(deployId, { type: 'error', message: `Failed to create/find project: ${err.message}`, timestamp: new Date().toISOString(), stage: 'create-project' });
        throw err;
      }

      if (envVars && Object.keys(envVars).length > 0) {
        this.emit(deployId, { type: 'progress', message: 'Injecting environment variables...', timestamp: new Date().toISOString(), stage: 'env-vars' });
        for (const [key, value] of Object.entries(envVars)) {
          try {
            await axios.post(`https://api.vercel.com/v9/projects/${projectId}/env`, {
              key, value, type: 'encrypted', target: ['production', 'preview', 'development'],
            }, { headers });
          } catch (err: any) {
            this.emit(deployId, { type: 'log', message: `Env var ${key}: ${err.response?.data?.error?.message || err.message}`, timestamp: new Date().toISOString(), stage: 'env-vars' });
          }
        }
      }

      this.emit(deployId, { type: 'progress', message: 'Triggering deployment...', timestamp: new Date().toISOString(), stage: 'deploy' });

      let deploymentUrl: string;
      try {
        const deploy = await axios.post('https://api.vercel.com/v13/deployments', {
          name: projectName,
          project: projectId,
          target: 'production',
          gitSource: { type: 'github', ref: 'main' },
        }, { headers });
        deploymentUrl = `https://${deploy.data.url}`;
        this.emit(deployId, { type: 'success', message: `Deployment created: ${deploymentUrl}`, timestamp: new Date().toISOString(), stage: 'deploy' });
      } catch (err: any) {
        this.emit(deployId, { type: 'error', message: `Deployment failed: ${err.message}`, timestamp: new Date().toISOString(), stage: 'deploy' });
        throw err;
      }

      return { success: true, url: deploymentUrl };
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      this.emit(deployId, { type: 'error', message: `Vercel deploy failed: ${msg}`, timestamp: new Date().toISOString(), stage: 'error' });
      return { success: false, error: msg };
    }
  }

  private static buildSSHCommand(options: { host: string; port: number; username: string; privateKey?: string; password?: string }): string {
    const args: string[] = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-p', String(options.port),
    ];
    if (options.privateKey) {
      args.push('-i', options.privateKey);
    }
    return `ssh ${args.join(' ')} ${options.username}@${options.host}`;
  }

  private static async execSSH(options: { host: string; port: number; username: string; privateKey?: string; password?: string }, cmd: string): Promise<string> {
    const base = this.buildSSHCommand(options);
    if (options.password) {
      return new Promise((resolve, reject) => {
        const child = spawn('sshpass', ['-p', options.password!, ...base.split(' ').slice(1), cmd]);
        let out = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { out += d.toString(); });
        child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(out)));
        child.on('error', reject);
      });
    }
    const { execSync } = require('child_process');
    return execSync(`${base} "${cmd.replace(/"/g, '\\"')}"`, { timeout: 120000 }).toString();
  }

  static async deployToVPS(options: VPSDeployOptions, deployId: string): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const { host, port, username, privateKey, password, repoUrl, branch, projectDir, envVars, nodeVersion } = options;
      const sshOpts = { host, port, username, privateKey, password };
      const sshBase = this.buildSSHCommand(sshOpts);

      this.emit(deployId, { type: 'log', message: `Connecting to ${username}@${host}:${port}...`, timestamp: new Date().toISOString(), stage: 'connect' });

      try {
        await this.execSSH(sshOpts, 'echo connected');
      } catch {
        return { success: false, error: `Cannot connect to ${host}. Check credentials and ensure the server is reachable.` };
      }

      this.emit(deployId, { type: 'log', message: 'Connected. Setting up server...', timestamp: new Date().toISOString(), stage: 'setup' });

      const nodeVer = nodeVersion || '20';
      const setupCommands = [
        `which node || (curl -fsSL https://deb.nodesource.com/setup_${nodeVer}.x | sudo bash - && sudo apt-get install -y nodejs)`,
        `which pm2 || npm install -g pm2`,
        `which git || sudo apt-get install -y git`,
        `which ffmpeg || (sudo apt-get update && sudo apt-get install -y ffmpeg)`,
      ];

      for (const cmd of setupCommands) {
        this.emit(deployId, { type: 'log', message: `Running: ${cmd.split('|')[0].trim()}...`, timestamp: new Date().toISOString(), stage: 'setup' });
        try {
          const r = await this.execSSH(sshOpts, cmd);
          if (r) this.emit(deployId, { type: 'log', message: r.substring(0, 200), timestamp: new Date().toISOString(), stage: 'setup' });
        } catch (e: any) {
          this.emit(deployId, { type: 'log', message: e.message.substring(0, 200), timestamp: new Date().toISOString(), stage: 'setup' });
        }
      }

      this.emit(deployId, { type: 'progress', message: 'Cloning repository...', timestamp: new Date().toISOString(), stage: 'clone' });

      const repoDir = projectDir || `/home/${username}/app`;
      const cloneCmd = `git clone ${repoUrl} ${repoDir} 2>/dev/null || (cd ${repoDir} && git pull)`;
      await this.execSSH(sshOpts, cloneCmd);

      if (branch) {
        await this.execSSH(sshOpts, `cd ${repoDir} && git checkout ${branch}`);
      }

      this.emit(deployId, { type: 'progress', message: 'Setting up environment...', timestamp: new Date().toISOString(), stage: 'env' });

      if (envVars && Object.keys(envVars).length > 0) {
        const envLines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
        for (const line of envLines) {
          await this.execSSH(sshOpts, `echo "${line}" >> ${repoDir}/.env`);
        }
        this.emit(deployId, { type: 'log', message: `Wrote ${Object.keys(envVars).length} env vars`, timestamp: new Date().toISOString(), stage: 'env' });
      }

      this.emit(deployId, { type: 'progress', message: 'Installing API dependencies...', timestamp: new Date().toISOString(), stage: 'install' });
      try {
        const apiInstall = await this.execSSH(sshOpts, `cd ${repoDir}/api && npm install 2>&1 | tail -5`);
        this.emit(deployId, { type: 'log', message: apiInstall.substring(0, 300), timestamp: new Date().toISOString(), stage: 'install' });
        await this.execSSH(sshOpts, `cd ${repoDir}/api && npx prisma generate`);
      } catch (e: any) {
        this.emit(deployId, { type: 'error', message: `API install failed: ${e.message.substring(0, 200)}`, timestamp: new Date().toISOString(), stage: 'install' });
      }

      this.emit(deployId, { type: 'progress', message: 'Building dashboard...', timestamp: new Date().toISOString(), stage: 'build' });
      try {
        const dashBuild = await this.execSSH(sshOpts, `cd ${repoDir}/apps/dashboard && npm install 2>&1 | tail -3 && npm run build 2>&1 | tail -10`);
        this.emit(deployId, { type: 'log', message: dashBuild.substring(0, 300), timestamp: new Date().toISOString(), stage: 'build' });
      } catch (e: any) {
        this.emit(deployId, { type: 'error', message: `Dashboard build: ${e.message.substring(0, 200)}`, timestamp: new Date().toISOString(), stage: 'build' });
      }

      this.emit(deployId, { type: 'progress', message: 'Running database migrations...', timestamp: new Date().toISOString(), stage: 'migrate' });
      try {
        const migrate = await this.execSSH(sshOpts, `cd ${repoDir}/api && npx prisma migrate deploy 2>&1`);
        this.emit(deployId, { type: 'log', message: migrate.substring(0, 300), timestamp: new Date().toISOString(), stage: 'migrate' });
      } catch (e: any) {
        this.emit(deployId, { type: 'log', message: `Migration: ${e.message.substring(0, 200)}`, timestamp: new Date().toISOString(), stage: 'migrate' });
      }

      this.emit(deployId, { type: 'progress', message: 'Starting services with PM2...', timestamp: new Date().toISOString(), stage: 'start' });

      await this.execSSH(sshOpts, `cd ${repoDir}/api && pm2 delete api 2>/dev/null; pm2 start npm --name api -- run start`);
      await this.execSSH(sshOpts, `cd ${repoDir}/apps/dashboard && pm2 delete dashboard 2>/dev/null; pm2 start npm --name dashboard -- run start`);
      await this.execSSH(sshOpts, 'pm2 save');

      this.emit(deployId, { type: 'success', message: `Deployment complete! API: http://${host}:4000, Dashboard: http://${host}:3000`, timestamp: new Date().toISOString(), stage: 'done' });

      return { success: true, url: `http://${host}:3000` };
    } catch (err: any) {
      this.emit(deployId, { type: 'error', message: `VPS deploy failed: ${err.message}`, timestamp: new Date().toISOString(), stage: 'error' });
      return { success: false, error: err.message };
    }
  }

  static async checkVPSStatus(options: { host: string; port: number; username: string; privateKey?: string; password?: string }): Promise<{ online: boolean; nodeVersion?: string; pm2Processes?: any[]; error?: string }> {
    try {
      const sshOpts = { host: options.host, port: options.port, username: options.username, privateKey: options.privateKey, password: options.password };
      const nodeVer = await this.execSSH(sshOpts, 'node --version 2>&1');
      const pm2List = await this.execSSH(sshOpts, 'pm2 list --no-color 2>&1');

      return {
        online: true,
        nodeVersion: nodeVer.trim(),
        pm2Processes: pm2List.split('\n').filter(l => l.includes('online') || l.includes('errored')).map(l => {
          const parts = l.split('│');
          return {
            name: parts[2]?.trim() || '',
            status: parts[3]?.trim() || 'unknown',
          };
        }),
      };
    } catch (err: any) {
      return { online: false, error: err.message };
    }
  }

  static async checkVercelStatus(token: string): Promise<{ connected: boolean; projects?: any[]; error?: string }> {
    try {
      const res = await axios.get('https://api.vercel.com/v9/projects?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { connected: true, projects: res.data.projects };
    } catch (err: any) {
      return { connected: false, error: err.response?.data?.error?.message || err.message };
    }
  }
}
