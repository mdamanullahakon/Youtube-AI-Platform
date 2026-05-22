# YouTube AI Platform — Complete Deployment Guide

## Pre-Deployment Checklist

### Security (✓ Verify All)
- [ ] Encryption keys generated and stored in AWS Secrets Manager
- [ ] TLS certificates obtained (Let's Encrypt or AWS Certificate Manager)
- [ ] YouTube OAuth credentials created in Google Cloud Console
- [ ] OpenAI API key obtained
- [ ] ElevenLabs API key obtained
- [ ] AWS IAM user created with S3 access
- [ ] Datadog API key (optional but recommended)
- [ ] Sentry DSN obtained for error tracking
- [ ] Network security reviewed (VPC, security groups)

### Infrastructure
- [ ] PostgreSQL HA cluster (3+ replicas) deployed
- [ ] Redis Sentinel or Redis Cluster deployed (3+ nodes)
- [ ] S3 bucket created with versioning enabled
- [ ] CloudFront distribution created for CDN
- [ ] Load balancer configured (AWS ALB or manual)
- [ ] Kubernetes cluster ready (EKS recommended)

### Monitoring
- [ ] Prometheus deployed
- [ ] Grafana dashboard set up
- [ ] Alertmanager configured
- [ ] Sentry project created
- [ ] Datadog agent setup (optional)
- [ ] ELK stack or CloudWatch Logs configured

---

## Step-by-Step Deployment

### Phase 1: Local Setup

```bash
# 1. Clone repository
git clone https://github.com/youtube-ai-platform/youtube-ai.git
cd youtube-ai

# 2. Install dependencies
npm install
npm run install-all

# 3. Set up environment
cp .env.production.example .env.production

# 4. Update .env.production with actual values:
# DATABASE_URL=postgresql://user:pass@db-host:5432/youtube_ai
# REDIS_URL=redis://:password@redis-host:6379
# ENCRYPTION_KEY=<32-byte-hex-string>
# YOUTUBE_CLIENT_ID=<from-google-console>
# ... etc

# 5. Build Docker image
docker build -t youtube-ai:latest .
docker tag youtube-ai:latest <REGISTRY>/youtube-ai:latest
docker push <REGISTRY>/youtube-ai:latest

# 6. Verify image
docker run --rm youtube-ai:latest npm run health-check
```

### Phase 2: Database Setup

```bash
# 1. Connect to PostgreSQL (via bastion or tunnel)
kubectl port-forward -n postgres svc/postgres 5432:5432

# 2. Create database
psql -h localhost -U postgres << EOF
CREATE DATABASE youtube_ai;
CREATE USER youtube_user WITH PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE youtube_ai TO youtube_user;
EOF

# 3. Run Prisma migrations
npm run prisma:migrate:deploy

# 4. Verify schema
psql -h localhost -d youtube_ai -U youtube_user -c "\dt"

# Expected tables: User, Video, Pipeline, YoutubeVideo, etc.
```

### Phase 3: Redis Setup

```bash
# 1. Verify Redis is running (3+ nodes for HA)
kubectl get pods -n redis

# 2. Test connectivity
kubectl exec -it redis-master -- redis-cli ping

# 3. Enable Sentinel (for automatic failover)
kubectl apply -f kubernetes/redis-sentinel.yaml

# 4. Verify Sentinel
kubectl logs -n redis redis-sentinel-0 | grep "Sentinel ID"
```

### Phase 4: Kubernetes Deployment

```bash
# 1. Create namespace
kubectl create namespace youtube-ai

# 2. Create secrets (from .env.production)
kubectl create secret generic youtube-ai-secrets \
  --from-literal=database-url=$DATABASE_URL \
  --from-literal=redis-url=$REDIS_URL \
  --from-literal=encryption-key=$ENCRYPTION_KEY \
  --from-literal=youtube-client-id=$YOUTUBE_CLIENT_ID \
  --from-literal=youtube-client-secret=$YOUTUBE_CLIENT_SECRET \
  --from-literal=openai-api-key=$OPENAI_API_KEY \
  --from-literal=elevenlabs-api-key=$ELEVENLABS_API_KEY \
  --from-literal=sentry-dsn=$SENTRY_DSN \
  -n youtube-ai

# 3. Create ConfigMap
kubectl create configmap youtube-ai-config \
  --from-file=config/ \
  -n youtube-ai

# 4. Deploy API and workers
kubectl apply -f kubernetes-deployment.yaml
kubectl apply -f kubernetes-services.yaml

# 5. Verify deployment
kubectl rollout status deployment/youtube-ai-api -n youtube-ai
kubectl rollout status deployment/youtube-ai-worker -n youtube-ai

# 6. Check pods are running
kubectl get pods -n youtube-ai

# Expected output:
# NAME                               READY   STATUS    RESTARTS   AGE
# youtube-ai-api-5b8d6c7f8g-abc12    1/1     Running   0          2m
# youtube-ai-api-5b8d6c7f8g-def45    1/1     Running   0          2m
# youtube-ai-api-5b8d6c7f8g-ghi78    1/1     Running   0          2m
# youtube-ai-worker-7k9j2m3n4p-x1     1/1     Running   0          2m
# ... (5 worker pods)
```

### Phase 5: Monitoring Setup

```bash
# 1. Deploy Prometheus
kubectl apply -f monitoring-config.yaml

# 2. Deploy Grafana (optional)
helm install grafana grafana/grafana -n monitoring

# 3. Get Grafana admin password
kubectl get secret grafana -n monitoring -o jsonpath="{.data.admin-password}" | base64 --decode

# 4. Access Grafana
kubectl port-forward -n monitoring svc/grafana 3000:80
# Open http://localhost:3000

# 5. Add Prometheus datasource in Grafana
# URL: http://prometheus:9090

# 6. Import YouTube AI dashboard
# Dashboard ID: 12345 (replace with actual)
# Or upload API_DOCUMENTATION.yaml content
```

### Phase 6: Health Checks

```bash
# 1. API Health
kubectl exec -it deployment/youtube-ai-api -n youtube-ai -- \
  curl -s http://localhost:3001/health | jq

# Expected: {"status": "ok", "uptime": 1234}

# 2. Worker Health
kubectl exec -it deployment/youtube-ai-worker -n youtube-ai -- \
  npm run health-check

# 3. Database Connection
kubectl exec -it deployment/youtube-ai-api -n youtube-ai -- \
  npm run test:db

# 4. Redis Connection
kubectl exec -it deployment/youtube-ai-worker -n youtube-ai -- \
  npm run test:redis

# 5. All health checks
kubectl exec -it deployment/youtube-ai-api -n youtube-ai -- \
  npm run health-check:all
```

### Phase 7: Load Testing (OPTIONAL)

```bash
# 1. Install k6 (load testing tool)
brew install k6  # or download from k6.io

# 2. Create load test script
cat > load-test.js << 'EOF'
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  let res = http.post('http://api.youtube-ai.example.com/api/pipeline/run', {
    topic: 'AI Trends 2026',
    language: 'en',
  });
  
  check(res, {
    'status is 202': (r) => r.status === 202,
    'job created': (r) => r.json('jobId') !== null,
  });
}
EOF

# 3. Run load test
k6 run load-test.js

# Monitor metrics during test:
# - API response time
# - Worker job queue depth
# - Database connection pool
# - Pod CPU/memory usage
```

### Phase 8: Ingress & DNS

```bash
# 1. Apply Ingress configuration
kubectl apply -f kubernetes-services.yaml

# 2. Get Ingress IP
kubectl get ingress youtube-ai-ingress -n youtube-ai
# Copy the EXTERNAL-IP

# 3. Update DNS to point to Ingress
# In Route 53 (or your DNS provider):
# api.youtube-ai.example.com  A  <EXTERNAL-IP>

# 4. Verify DNS propagation
nslookup api.youtube-ai.example.com

# 5. Test HTTPS (with TLS certificate)
curl -v https://api.youtube-ai.example.com/health

# Expected: 200 OK with valid TLS cert
```

---

## Troubleshooting Deployment

### Issue: Pods stuck in "Pending"
```bash
# Check events
kubectl describe pod <pod-name> -n youtube-ai

# Likely causes:
# - Not enough cluster resources (scale cluster)
# - Image pull error (check image registry access)
# - PVC not bound (check storage class)

# Solution:
kubectl top nodes  # Check node resources
kubectl get events -n youtube-ai  # Check error messages
```

### Issue: CrashLoopBackOff
```bash
# Check logs
kubectl logs deployment/youtube-ai-api -n youtube-ai --tail=100

# Common causes:
# - Database connection failed (check DATABASE_URL)
# - Missing secrets (check kubectl get secrets -n youtube-ai)
# - Port already in use

# Solution:
kubectl set env deployment/youtube-ai-api DATABASE_URL=$NEW_URL -n youtube-ai
kubectl rollout restart deployment/youtube-ai-api -n youtube-ai
```

### Issue: ImagePullBackOff
```bash
# Check image registry access
kubectl describe pod <pod-name> -n youtube-ai

# Solution:
# Create image pull secret
kubectl create secret docker-registry docker-registry-secret \
  --docker-server=<REGISTRY> \
  --docker-username=<USERNAME> \
  --docker-password=<PASSWORD> \
  -n youtube-ai

# Update deployment to use secret
kubectl patch serviceaccount youtube-ai -n youtube-ai \
  -p '{"imagePullSecrets": [{"name": "docker-registry-secret"}]}'
```

---

## Post-Deployment Verification

```bash
# 1. Run E2E tests
kubectl exec -it deployment/youtube-ai-api -n youtube-ai -- \
  npm run test:e2e

# 2. Verify pipeline works
curl -X POST https://api.youtube-ai.example.com/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Test Video",
    "language": "en",
    "tone": "engaging",
    "length": "short"
  }'

# Should return 202 with jobId

# 3. Check job status
curl https://api.youtube-ai.example.com/api/pipeline/<jobId>

# Should show progress from 0 to 100

# 4. Monitor logs
kubectl logs -f deployment/youtube-ai-worker -n youtube-ai | grep -i "job\|complete"

# 5. Check metrics
kubectl exec -it deployment/youtube-ai-api -n youtube-ai -- \
  curl -s http://localhost:9090/metrics | grep bullmq
```

---

## Rollback Procedure (If Issues Occur)

```bash
# 1. Check rollout history
kubectl rollout history deployment/youtube-ai-api -n youtube-ai

# 2. View specific revision
kubectl rollout history deployment/youtube-ai-api -n youtube-ai --revision=2

# 3. Rollback to previous version
kubectl rollout undo deployment/youtube-ai-api -n youtube-ai

# 4. Verify rollback
kubectl rollout status deployment/youtube-ai-api -n youtube-ai

# 5. Check new pod status
kubectl get pods -n youtube-ai

# 6. Monitor logs during rollback
kubectl logs -f deployment/youtube-ai-api -n youtube-ai
```

---

## Scaling for Production

### Vertical Scaling
```bash
# Increase resource limits
kubectl set resources deployment/youtube-ai-api \
  --limits=cpu=2000m,memory=2Gi \
  --requests=cpu=1000m,memory=1Gi \
  -n youtube-ai

# Increase worker instances manually
kubectl scale deployment/youtube-ai-worker --replicas=10 -n youtube-ai
```

### Horizontal Scaling (HPA - Auto)
```bash
# Apply HPA configuration
kubectl apply -f - << EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: youtube-ai-api-hpa
  namespace: youtube-ai
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: youtube-ai-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
EOF

# Monitor autoscaling
kubectl get hpa -n youtube-ai -w
```

---

## Backup & Disaster Recovery

```bash
# 1. Backup database
kubectl exec -it <postgres-pod> -- \
  pg_dump -U youtube_user youtube_ai > backup.sql

# 2. Backup Redis
kubectl exec -it redis-master -- \
  redis-cli BGSAVE

# 3. Backup S3 videos
aws s3 sync s3://youtube-ai-prod ./backups/s3

# 4. Automated backups (daily)
# Add CronJob to Kubernetes:
kubectl apply -f - << 'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: youtube-ai-backup
  namespace: youtube-ai
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: youtube-ai:latest
            command:
            - /bin/bash
            - -c
            - |
              pg_dump $DATABASE_URL | gzip > backup-$(date +%Y%m%d).sql.gz
              aws s3 cp backup-*.sql.gz s3://youtube-ai-backups/
          restartPolicy: OnFailure
EOF
```

---

## Maintenance Schedule

### Daily
- [ ] Check error rate (< 1%)
- [ ] Verify job success rate (> 95%)
- [ ] Monitor pod restarts

### Weekly
- [ ] Review slow queries
- [ ] Check disk usage
- [ ] Audit access logs
- [ ] Review deployment errors

### Monthly
- [ ] Rotate encryption keys
- [ ] Update API key credentials
- [ ] Review cost optimization
- [ ] Conduct disaster recovery drill

### Quarterly
- [ ] Full security audit
- [ ] Upgrade dependencies
- [ ] Load testing
- [ ] Capacity planning review

---

## Support & Escalation

**Deployment Issues:** contact-devops@youtube-ai.example.com  
**Security Issues:** security@youtube-ai.example.com  
**Critical Incidents:** Page on-call engineer via PagerDuty

---

**Deployment Document Version:** 1.0  
**Last Updated:** 2026-05-22  
**Maintained By:** DevOps Team
