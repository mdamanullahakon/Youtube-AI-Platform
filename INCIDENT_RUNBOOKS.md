# Incident Response Runbooks for YouTube AI Platform

## Critical Incidents

### 1. Database Connection Pool Exhausted

**Severity:** CRITICAL  
**Impact:** API requests fail with "connection pool exhausted"  
**Detection:** Alert: `db_connection_pool_active / db_connection_pool_size > 0.95`

#### Immediate Actions (0-5 min):
1. Page on-call engineer
2. Check current connections: `SELECT count(*) FROM pg_stat_activity;`
3. Identify long-running queries: `SELECT * FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start DESC;`
4. Kill idle connections if necessary: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < NOW() - INTERVAL '10 minutes';`

#### Remediation (5-15 min):
1. Increase `DATABASE_POOL_SIZE` environment variable (current: 20, max: 50)
2. Restart API pods: `kubectl rollout restart deployment/youtube-ai-api`
3. Monitor recovery: `kubectl logs -f deployment/youtube-ai-api`
4. If still failing, scale down workers: `kubectl scale deployment youtube-ai-worker --replicas=2`

#### Investigation (15-60 min):
1. Review application logs for query patterns
2. Check for connection leaks in code
3. Run VACUUM on database: `VACUUM ANALYZE;`
4. Consider read replica for analytics queries

**Prevention:** Set connection timeout and pooling settings in Prisma schema

---

### 2. Job Queue Backlog (1000+ pending jobs)

**Severity:** HIGH  
**Impact:** Video generation delays, customer complaints  
**Detection:** Alert: `bullmq_queue_size > 1000`

#### Immediate Actions (0-5 min):
1. Check queue depth: `npm run redis-cli`
2. List queue: `XLEN youtube-ai:pipeline:pending`
3. Check worker status: `kubectl get pods -l tier=worker`
4. Monitor processing rate: `XINFO STREAM youtube-ai:pipeline:pending`

#### Remediation (5-15 min):
1. Scale workers: `kubectl scale deployment youtube-ai-worker --replicas=10`
2. Monitor job processing: `watch -n 2 'npm run redis-cli -- XLEN youtube-ai:pipeline:pending'`
3. If workers are healthy, let them work through backlog
4. If workers are failing, check logs: `kubectl logs -f deployment/youtube-ai-worker`

#### Common Causes:
- YouTube API quota exceeded
- ElevenLabs API rate limit
- FFmpeg resource exhaustion
- Database slow queries

**Solution by Cause:**
- **API Quota:** Wait for quota reset or upgrade API tier
- **Rate Limit:** Add exponential backoff (already implemented)
- **Resource:** Scale workers to different nodes
- **Database:** Run VACUUM ANALYZE or increase pool

---

### 3. High Error Rate (>5% of requests)

**Severity:** CRITICAL  
**Impact:** API mostly unavailable, pipeline failures  
**Detection:** Alert: `rate(http_requests_total{status=~"5.."}[5m]) > 0.05`

#### Immediate Actions (0-5 min):
1. Check error logs: `kubectl logs -f deployment/youtube-ai-api --tail=200 | grep -i error`
2. Check Sentry dashboard: Filter by timeframe and error type
3. Identify error pattern (database? external API? code?)

#### Remediation by Error Type:

**Database Connection Errors:**
```bash
# Check PostgreSQL status
kubectl exec -it <postgres-pod> -- psql -c "SELECT * FROM pg_stat_connections;"
# Restart PostgreSQL if needed
kubectl restart statefulset postgres
```

**External API Errors (YouTube/OpenAI/ElevenLabs):**
```bash
# Check API status pages
# Add temporary retry delays
# Scale workers to reduce concurrent API calls
kubectl scale deployment youtube-ai-worker --replicas=2
```

**Memory/OOM Errors:**
```bash
# Check pod memory usage
kubectl top pod -l app=youtube-ai
# Restart pod if OOM
kubectl delete pod <pod-name>
```

**Code Errors:**
```bash
# Check Sentry for stack traces
# If critical: roll back deployment
kubectl rollout undo deployment/youtube-ai-api
```

---

### 4. Redis Connection Lost

**Severity:** CRITICAL  
**Impact:** Job queue unavailable, pipeline halted  
**Detection:** Pod logs show "REDIS_ERROR" or "connection refused"

#### Immediate Actions (0-5 min):
1. Check Redis pod status: `kubectl get pods -l app=redis`
2. Check Redis connectivity: `kubectl exec -it <redis-pod> -- redis-cli ping`
3. Check Redis logs: `kubectl logs <redis-pod>`

#### Remediation (5-15 min):
1. If Redis pod is down, restart: `kubectl delete pod <redis-pod>`
2. If Redis is up but slow, check memory: `kubectl exec -it <redis-pod> -- redis-cli INFO memory`
3. If memory full, evict old keys:
   ```bash
   kubectl exec -it <redis-pod> -- redis-cli CONFIG GET maxmemory-policy
   kubectl exec -it <redis-pod> -- redis-cli CONFIG SET maxmemory-policy "allkeys-lru"
   ```
4. Verify API recovers: `kubectl get pods -l app=youtube-ai-api`

#### Failover (Sentinel):
1. Check Sentinel status: `kubectl logs -l app=redis-sentinel`
2. If automatic failover doesn't happen, trigger manual: `redis-cli SENTINEL failover <master-name>`

---

### 5. Disk Space Critical (>95%)

**Severity:** HIGH  
**Impact:** Database writes fail, video uploads fail  
**Detection:** Alert: `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.05`

#### Immediate Actions (0-5 min):
1. Check disk usage: `df -h`
2. Identify large directories: `du -sh /* | sort -h`
3. Check database size: `du -sh /var/lib/postgresql`

#### Remediation (5-30 min):
1. Clean up old logs: `find /var/log -mtime +7 -delete`
2. Clean up temp files: `rm -rf /tmp/*`
3. Archive old videos: `aws s3 sync ./videos s3://youtube-ai-backup/videos --exclude "*.mp4" && rm -rf ./videos/*`
4. Expand volume: `kubectl patch pvc data-pvc -p '{"spec":{"resources":{"requests":{"storage":"500Gi"}}}}'`

---

### 6. Pod Crash Looping

**Severity:** HIGH  
**Impact:** API/worker pods keep restarting  
**Detection:** Alert: `kube_pod_container_status_restarts_total > 5 in 1h`

#### Immediate Actions (0-5 min):
1. Check pod status: `kubectl describe pod <pod-name>`
2. Check last logs: `kubectl logs <pod-name> --previous`
3. Check events: `kubectl get events --sort-by='.lastTimestamp' | tail -20`

#### Common Causes & Solutions:

**OOM Kill:**
```bash
# Increase memory limit
kubectl set resources deployment youtube-ai-api --limits=memory=2Gi
```

**Liveness Probe Failing:**
```bash
# Check /health endpoint: curl http://localhost:3001/health
# If failing, check application logs for startup issues
kubectl logs <pod-name> -f
```

**Database Migration Failure:**
```bash
# Run migration manually
kubectl exec -it <pod> -- npm run prisma:migrate:deploy
# If migration stuck, reset: npm run prisma:migrate:reset
```

**Invalid Configuration:**
```bash
# Check environment variables
kubectl exec <pod> -- env | grep DATABASE_URL
# Check secrets are mounted
kubectl describe pod <pod-name> | grep -A 5 "Mounts:"
```

---

## Non-Critical Incidents

### 7. Slow API Response Time (p99 > 10s)

**Severity:** MEDIUM  
**Detection:** Prometheus metric: `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 10`

**Actions:**
1. Identify slow endpoints: Check Datadog APM
2. Check database slow query log: `kubectl exec <postgres> -- tail -f /var/log/postgresql/slow.log`
3. Run query analysis: `EXPLAIN ANALYZE <slow-query>`
4. Create indexes if missing
5. Cache frequently accessed data in Redis

---

### 8. High Memory Usage (>80%)

**Severity:** MEDIUM  
**Detection:** `container_memory_usage_bytes > 0.8 * container_spec_memory_limit_bytes`

**Actions:**
1. Identify memory leaks: Check Node.js heap
2. Reduce worker concurrency (default: 10)
3. Implement memory limits in code (query pagination, batch size)
4. Restart pod if memory keeps growing

---

### 9. FFmpeg Rendering Failures

**Severity:** MEDIUM  
**Impact:** Video rendering fails, job retries 3 times  
**Detection:** Logs show "ffmpeg: error" or job fails

**Actions:**
1. Check FFmpeg logs in worker pod
2. Verify input audio file exists and is valid
3. Check disk space on worker node
4. Check GPU availability (if using GPU rendering)
5. Increase timeout in pipeline.worker.ts

---

### 10. YouTube API Quota Exceeded

**Severity:** MEDIUM  
**Impact:** Upload/analytics jobs fail  
**Detection:** Error response: "quotaExceeded"

**Actions:**
1. Check YouTube API quota: https://console.cloud.google.com
2. Wait 24 hours for quota reset
3. Upgrade API quota tier
4. Temporarily reduce pipeline throughput: `kubectl scale deployment youtube-ai-worker --replicas=1`
5. Prioritize critical jobs

---

## Post-Incident (After incident is resolved)

### Runbook Template:

1. **Incident Summary**
   - What happened?
   - Duration?
   - Impact (# affected users, revenue loss)?

2. **Root Cause Analysis**
   - What was the underlying cause?
   - Could it have been prevented?

3. **Response Timeline**
   - When detected?
   - When started responding?
   - When resolved?

4. **Remediation**
   - What was done to fix it?
   - What temporary workarounds were used?

5. **Prevention**
   - What alerts should catch this earlier?
   - What code/config changes prevent recurrence?
   - What monitoring is needed?

6. **Action Items**
   - Assign owner for each prevention item
   - Set deadline (e.g., 1 week)
   - Track in incident management system

---

## Alert Configuration Examples

```yaml
# For Prometheus AlertManager (monitoring-config.yaml)
- alert: DatabaseConnectionPoolExhausted
  expr: db_connection_pool_active / db_connection_pool_size > 0.95
  for: 5m
  annotations:
    severity: critical
    summary: "Database connection pool exhausted"
    runbook: "docs/runbooks/database-connection-pool-exhausted.md"

- alert: JobQueueBacklog
  expr: bullmq_queue_size > 1000
  for: 10m
  annotations:
    severity: high
    summary: "Large job queue backlog"
    runbook: "docs/runbooks/job-queue-backlog.md"
```

---

## Communication Template (for customer notification)

**Subject:** [INCIDENT] YouTube AI Platform - Partial Service Degradation

**Body:**
We detected an issue affecting video uploads at {time}. Our team is investigating.

**Impact:** ~{number} videos queued for processing may experience delays

**Current Status:** {investigating | mitigating | resolved}

**Next Update:** In 30 minutes

**Timeline:**
- {14:30} Issue detected
- {14:35} Team alerted
- {15:00} Root cause identified
- {15:45} Fix deployed
- {16:00} Service recovered

**What We're Doing:**
- Scaling infrastructure to handle queue
- Investigating root cause
- Implementing preventative monitoring

We'll follow up with a detailed post-incident report in 24 hours.
