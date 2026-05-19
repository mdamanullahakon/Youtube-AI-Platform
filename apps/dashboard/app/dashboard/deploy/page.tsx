'use client';

import { useState, useRef, useEffect } from 'react';
import { apiClient } from '@/store';

const DEPLOY_TABS = ['vercel', 'vps', 'logs'] as const;
type DeployTab = (typeof DEPLOY_TABS)[number];

interface DeployLog {
  type: 'log' | 'error' | 'success' | 'progress';
  message: string;
  timestamp: string;
  stage?: string;
}

export default function DeployPage() {
  const [tab, setTab] = useState<DeployTab>('vercel');
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [deployResult, setDeployResult] = useState<{ success?: boolean; url?: string; error?: string } | null>(null);

  const [vercelToken, setVercelToken] = useState('');
  const [vercelProjectName, setVercelProjectName] = useState('');
  const [vercelStatus, setVercelStatus] = useState<{ connected?: boolean; projects?: any[]; error?: string } | null>(null);

  const [vpsHost, setVpsHost] = useState('');
  const [vpsPort, setVpsPort] = useState('22');
  const [vpsUsername, setVpsUsername] = useState('root');
  const [vpsPassword, setVpsPassword] = useState('');
  const [vpsPrivateKey, setVpsPrivateKey] = useState('');
  const [vpsRepoUrl, setVpsRepoUrl] = useState('');
  const [vpsBranch, setVpsBranch] = useState('main');
  const [vpsStatus, setVpsStatus] = useState<{ online?: boolean; nodeVersion?: string; pm2Processes?: any[]; error?: string } | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (log: DeployLog) => {
    setLogs(prev => [...prev, log]);
  };

  const checkVercelStatus = async () => {
    if (!vercelToken) return;
    const res = await apiClient(`/api/deploy/status?type=vercel&token=${encodeURIComponent(vercelToken)}`);
    if (res.success) setVercelStatus(res);
  };

  const checkVPSStatus = async () => {
    if (!vpsHost || !vpsUsername) return;
    const res = await apiClient(`/api/deploy/status?type=vps&host=${encodeURIComponent(vpsHost)}&port=${vpsPort}&username=${encodeURIComponent(vpsUsername)}`);
    if (res.success) setVpsStatus(res);
  };

  const deployVercel = async () => {
    setDeploying(true);
    setLogs([]);
    setDeployResult(null);
    addLog({ type: 'log', message: 'Starting Vercel deployment...', timestamp: new Date().toISOString(), stage: 'init' });

    const res = await apiClient('/api/deploy/vercel', {
      method: 'POST',
      body: JSON.stringify({ token: vercelToken, projectName: vercelProjectName, framework: 'nextjs' }),
    });

    setDeployResult({ success: res.success, url: res.url, error: res.error });
    addLog({ type: res.success ? 'success' : 'error', message: res.success ? `Deployed to ${res.url}` : `Failed: ${res.error}`, timestamp: new Date().toISOString(), stage: 'done' });
    setDeploying(false);
  };

  const deployVPS = async () => {
    setDeploying(true);
    setLogs([]);
    setDeployResult(null);
    addLog({ type: 'log', message: 'Starting VPS deployment...', timestamp: new Date().toISOString(), stage: 'init' });

    const body: any = { host: vpsHost, port: parseInt(vpsPort), username: vpsUsername, repoUrl: vpsRepoUrl, branch: vpsBranch };
    if (vpsPassword) body.password = vpsPassword;
    if (vpsPrivateKey) body.privateKey = vpsPrivateKey;

    const res = await apiClient('/api/deploy/vps', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    setDeployResult({ success: res.success, url: res.url, error: res.error });
    addLog({ type: res.success ? 'success' : 'error', message: res.success ? `Deployed to ${res.url}` : `Failed: ${res.error}`, timestamp: new Date().toISOString(), stage: 'done' });
    setDeploying(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Deploy System</h1>
        <p className="text-muted mt-1">One-click deployment for Vercel and VPS</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('vercel')} className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'vercel' ? 'bg-primary text-white' : 'bg-card border border-card-border text-muted hover:text-foreground'}`}>
          Vercel Deploy
        </button>
        <button onClick={() => setTab('vps')} className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'vps' ? 'bg-primary text-white' : 'bg-card border border-card-border text-muted hover:text-foreground'}`}>
          VPS Deploy
        </button>
        <button onClick={() => setTab('logs')} className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'logs' ? 'bg-primary text-white' : 'bg-card border border-card-border text-muted hover:text-foreground'}`}>
          Deploy Logs
        </button>
      </div>

      {tab === 'vercel' && (
        <div className="glow-card rounded-xl p-6 space-y-4">
          <h2 className="text-xl font-semibold">Vercel Deployment</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted block mb-1">Vercel API Token</label>
              <input type="password" className="input-field" value={vercelToken} onChange={e => setVercelToken(e.target.value)} placeholder="Your Vercel API token" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Project Name</label>
              <input className="input-field" value={vercelProjectName} onChange={e => setVercelProjectName(e.target.value)} placeholder="youtube-ai-platform" />
            </div>
            <div className="flex gap-3">
              <button onClick={checkVercelStatus} disabled={!vercelToken} className="btn-secondary text-sm">
                Check Status
              </button>
              <button onClick={deployVercel} disabled={deploying || !vercelToken || !vercelProjectName} className="btn-primary text-sm">
                {deploying ? 'Deploying...' : 'Deploy to Vercel'}
              </button>
            </div>
            {vercelStatus && (
              <div className={`p-3 rounded-xl text-sm ${vercelStatus.connected ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {vercelStatus.connected ? `Connected. Found ${vercelStatus.projects?.length || 0} project(s).` : `Error: ${vercelStatus.error}`}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'vps' && (
        <div className="glow-card rounded-xl p-6 space-y-4">
          <h2 className="text-xl font-semibold">VPS Deployment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted block mb-1">Server Host</label>
              <input className="input-field" value={vpsHost} onChange={e => setVpsHost(e.target.value)} placeholder="192.168.1.1" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">SSH Port</label>
              <input className="input-field" value={vpsPort} onChange={e => setVpsPort(e.target.value)} placeholder="22" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Username</label>
              <input className="input-field" value={vpsUsername} onChange={e => setVpsUsername(e.target.value)} placeholder="root" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Password (or use SSH key)</label>
              <input type="password" className="input-field" value={vpsPassword} onChange={e => setVpsPassword(e.target.value)} placeholder="SSH password" />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-muted block mb-1">Git Repo URL</label>
              <input className="input-field" value={vpsRepoUrl} onChange={e => setVpsRepoUrl(e.target.value)} placeholder="https://github.com/username/repo.git" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">Branch</label>
              <input className="input-field" value={vpsBranch} onChange={e => setVpsBranch(e.target.value)} placeholder="main" />
            </div>
            <div>
              <label className="text-sm text-muted block mb-1">SSH Private Key (optional)</label>
              <textarea className="input-field" rows={3} value={vpsPrivateKey} onChange={e => setVpsPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={checkVPSStatus} disabled={!vpsHost || !vpsUsername} className="btn-secondary text-sm">
              Check Status
            </button>
            <button onClick={deployVPS} disabled={deploying || !vpsHost || !vpsUsername || !vpsRepoUrl} className="btn-primary text-sm">
              {deploying ? 'Deploying...' : 'Deploy to VPS'}
            </button>
          </div>
          {vpsStatus && (
            <div className={`p-3 rounded-xl text-sm ${vpsStatus.online ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {vpsStatus.online ? `Online. Node: ${vpsStatus.nodeVersion}. Processes: ${vpsStatus.pm2Processes?.length || 0}` : `Offline: ${vpsStatus.error}`}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="glow-card rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Deployment Logs</h2>
          {logs.length === 0 && !deploying && (
            <p className="text-muted text-sm">No logs yet. Start a deployment to see real-time logs.</p>
          )}
          <div className="bg-black/50 rounded-xl p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-2 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : log.type === 'progress' ? 'text-yellow-400' : 'text-gray-400'}`}>
                <span className="shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span>{log.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {deployResult && (
        <div className={`glow-card rounded-xl p-4 ${deployResult.success ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <p className={`font-semibold ${deployResult.success ? 'text-green-400' : 'text-red-400'}`}>
            {deployResult.success ? `Successfully deployed at ${deployResult.url}` : `Deployment failed: ${deployResult.error}`}
          </p>
        </div>
      )}
    </div>
  );
}
