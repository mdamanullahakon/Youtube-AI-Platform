import { Request, Response, NextFunction } from 'express';
import { DeployService } from '../services/deploy.service';
import { v4 as uuidv4 } from 'uuid';

export async function deployVercel(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, projectName, framework, rootDirectory, envVars } = req.body;
    if (!token || !projectName) {
      return res.status(400).json({ success: false, message: 'Vercel token and project name required' });
    }

    const deployId = uuidv4();
    const result = await DeployService.deployToVercel({
      token,
      projectName,
      framework: framework || 'nextjs',
      rootDirectory,
      envVars,
    }, deployId);

    res.json({ success: result.success, deployId, url: result.url, error: result.error });
  } catch (err: any) {
    next(err);
  }
}

export async function deployVPS(req: Request, res: Response, next: NextFunction) {
  try {
    const { host, port, username, privateKey, password, repoUrl, branch, projectDir, envVars, nodeVersion } = req.body;
    if (!host || !username || !repoUrl) {
      return res.status(400).json({ success: false, message: 'Host, username, and repo URL required' });
    }

    const deployId = uuidv4();
    const result = await DeployService.deployToVPS({
      host, port: port || 22, username, privateKey, password, repoUrl, branch, projectDir, envVars, nodeVersion,
    }, deployId);

    res.json({ success: result.success, deployId, url: result.url, error: result.error });
  } catch (err: any) {
    next(err);
  }
}

export async function checkStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, host, port, username, token } = req.query;

    if (type === 'vercel') {
      if (!token) return res.status(400).json({ success: false, message: 'Vercel token required' });
      const result = await DeployService.checkVercelStatus(token as string);
      return res.json({ success: true, ...result });
    }

    if (type === 'vps') {
      if (!host || !username) return res.status(400).json({ success: false, message: 'Host and username required' });
      const result = await DeployService.checkVPSStatus({
        host: host as string,
        port: parseInt(port as string) || 22,
        username: username as string,
      });
      return res.json({ success: true, ...result });
    }

    res.status(400).json({ success: false, message: 'Invalid status check type. Use "vercel" or "vps".' });
  } catch (err: any) {
    next(err);
  }
}

export async function getDeployLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const { deployId } = req.query;
    res.json({
      success: true,
      message: 'Streaming endpoint. Use SSE for real-time logs.',
      deployId,
    });
  } catch (err: any) {
    next(err);
  }
}
