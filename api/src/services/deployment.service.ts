// Phase 4 — Infrastructure hardening and deployment
import * as path from 'path';

export const DEPLOYMENT_CONFIG = {
  production: {
    database: {
      type: 'postgres',
      connection: process.env.DATABASE_URL || 'postgresql://user:password@db:5432/youtube-ai',
      ssl: true,
      poolSize: 20,
      maxIdleTime: 30000,
    },
    redis: {
      type: 'redis-cluster',
      sentinels: process.env.REDIS_SENTINELS?.split(',') || ['redis1:26379', 'redis2:26379'],
      database: 0,
      password: process.env.REDIS_PASSWORD,
    },
    storage: {
      type: 's3',
      bucket: process.env.S3_BUCKET || 'youtube-ai-videos',
      region: process.env.AWS_REGION || 'us-east-1',
      acl: 'private',
    },
    monitoring: {
      prometheus: true,
      datadog: process.env.DATADOG_API_KEY ? true : false,
      sentry: process.env.SENTRY_DSN ? true : false,
    },
    security: {
      tlsCert: process.env.TLS_CERT_PATH,
      tlsKey: process.env.TLS_KEY_PATH,
      encryptionKey: process.env.ENCRYPTION_KEY,
    },
  },
  staging: {
    database: {
      type: 'postgres',
      connection: process.env.DATABASE_URL || 'postgresql://user:password@db-staging:5432/youtube-ai-staging',
      ssl: true,
      poolSize: 10,
    },
    redis: {
      type: 'redis',
      host: process.env.REDIS_HOST || 'redis-staging',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
    },
    storage: {
      type: 's3',
      bucket: process.env.S3_BUCKET || 'youtube-ai-staging',
    },
    monitoring: {
      prometheus: true,
      datadog: false,
      sentry: true,
    },
  },
  development: {
    database: {
      type: 'sqlite',
      path: './data/dev.db',
    },
    redis: {
      type: 'redis',
      host: 'localhost',
      port: 6379,
    },
    storage: {
      type: 'local',
      path: './data/uploads',
    },
  },
};

export interface DeploymentChecklist {
  id: string;
  category: string;
  item: string;
  status: 'pending' | 'done' | 'blocked';
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export const DEPLOYMENT_CHECKLIST: DeploymentChecklist[] = [
  // Security
  {
    id: 'sec-001',
    category: 'Security',
    item: 'Encryption keys rotated and secured in AWS Secrets Manager',
    severity: 'critical',
    status: 'pending',
  },
  {
    id: 'sec-002',
    category: 'Security',
    item: 'TLS certificates installed and auto-renewal configured',
    severity: 'critical',
    status: 'pending',
  },
  {
    id: 'sec-003',
    category: 'Security',
    item: 'API rate limiting enabled (100 req/min per IP)',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'sec-004',
    category: 'Security',
    item: 'OAuth tokens encrypted at rest (AES-256-GCM)',
    severity: 'critical',
    status: 'pending',
  },

  // Infrastructure
  {
    id: 'infra-001',
    category: 'Infrastructure',
    item: 'PostgreSQL HA cluster (3+ replicas) deployed',
    severity: 'critical',
    status: 'pending',
  },
  {
    id: 'infra-002',
    category: 'Infrastructure',
    item: 'Redis Sentinel or Cluster for failover (3+ nodes)',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'infra-003',
    category: 'Infrastructure',
    item: 'S3 bucket versioning and MFA delete enabled',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'infra-004',
    category: 'Infrastructure',
    item: 'CloudFront CDN in front of API and media assets',
    severity: 'medium',
    status: 'pending',
  },

  // Monitoring
  {
    id: 'mon-001',
    category: 'Monitoring',
    item: 'Prometheus metrics exported on :9090/metrics',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'mon-002',
    category: 'Monitoring',
    item: 'Alerting configured for error rates >5%',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'mon-003',
    category: 'Monitoring',
    item: 'Sentry error tracking integrated',
    severity: 'medium',
    status: 'pending',
  },
  {
    id: 'mon-004',
    category: 'Monitoring',
    item: 'Log aggregation (ELK / CloudWatch) set up',
    severity: 'medium',
    status: 'pending',
  },

  // Compliance
  {
    id: 'comp-001',
    category: 'Compliance',
    item: 'GDPR consent tracking for user data',
    severity: 'critical',
    status: 'pending',
  },
  {
    id: 'comp-002',
    category: 'Compliance',
    item: 'YouTube ToS compliance audit completed',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'comp-003',
    category: 'Compliance',
    item: 'Privacy policy and Terms of Service published',
    severity: 'high',
    status: 'pending',
  },

  // Testing
  {
    id: 'test-001',
    category: 'Testing',
    item: 'E2E tests pass (script→video→upload flow)',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'test-002',
    category: 'Testing',
    item: 'Load testing: 1000 concurrent jobs supported',
    severity: 'high',
    status: 'pending',
  },
  {
    id: 'test-003',
    category: 'Testing',
    item: 'Disaster recovery drill completed',
    severity: 'medium',
    status: 'pending',
  },
];

export async function validateDeploymentReadiness(): Promise<{
  ready: boolean;
  passedChecks: number;
  failedChecks: number;
  blockedChecks: number;
  criticalIssues: DeploymentChecklist[];
}> {
  const critical = DEPLOYMENT_CHECKLIST.filter(c => c.severity === 'critical' && c.status !== 'done');
  const passed = DEPLOYMENT_CHECKLIST.filter(c => c.status === 'done').length;
  const failed = DEPLOYMENT_CHECKLIST.filter(c => c.status === 'blocked').length;
  const blocked = DEPLOYMENT_CHECKLIST.filter(c => c.status === 'pending').length;

  return {
    ready: critical.length === 0,
    passedChecks: passed,
    failedChecks: failed,
    blockedChecks: blocked,
    criticalIssues: critical,
  };
}

export default { DEPLOYMENT_CONFIG, DEPLOYMENT_CHECKLIST, validateDeploymentReadiness };
