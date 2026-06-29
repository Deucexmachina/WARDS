# WARDS AI and Recovery Operations

This document describes the deployed WARDS security flow for the two-VM setup:

- VM1: WARDS/OCR application server, VM1 database, GitHub webhook deployer, VM1 security reporter.
- VM2: SECURITY API, security database, monitoring engine, backups, AI/ML artifacts, VM1 manifest processor.

The deployment goal is simple: code changes from GitHub must not be treated as defacement. During deployment, VM2 enters deployment mode, VM1 and VM2 pull the same commit, VM1 uploads a manifest for that commit while deployment mode is still active, and only then does monitoring resume.

## CI/CD Deployment Flow

1. GitHub push to `main` starts CI.
2. CI runs backend, frontend, security, recovery, AI, auth, and deployment hardening tests.
3. GitHub webhook hits VM1 on port `9000`.
4. VM1 webhook tells VM2 to enter deployment mode:

```bash
curl -sS -X POST "https://<VM2_HOST>/internal/deployment-mode" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"in_progress":true,"target_commit":"<GIT_COMMIT>"}'
```

5. VM1 pulls and rebuilds the application containers.
6. VM1 verifies its local Git commit equals the pushed commit.
7. VM1 tells VM2 to deploy.
8. VM2 pulls and rebuilds/restarts the SECURITY service.
9. VM2 verifies its local Git commit equals the pushed commit.
10. VM1 reporter uploads a file manifest containing its Git commit.
11. While deployment mode is active, VM2 updates VM1 file baselines and snapshots instead of creating detections.
12. VM2 marks `deployment_vm1_baseline_ready=true` only when the VM1 manifest commit equals `deployment_target_commit`.
13. VM1 webhook waits for:

```text
VM1 commit == target commit
VM2 commit == target commit
VM1 manifest commit == target commit
deployment_vm1_baseline_ready == true
```

14. VM1 webhook triggers a post-deploy full backup.
15. VM1 webhook clears deployment mode:

```bash
curl -sS -X POST "https://<VM2_HOST>/internal/deployment-mode" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"in_progress":false}'
```

16. GitHub Actions `deploy-status` waits until both VMs report the exact pushed commit, VM1 baseline is ready, and deployment mode is false.

## Deployment Validation Commands

Run on your workstation:

```bash
curl -sS "http://<VM1_HOST>:9000/deploy-status" | jq
curl -sS "http://<VM1_HOST>:9000/vm2-deploy-status" | jq
```

Expected after a successful deploy:

```json
{
  "commit": "<same commit as VM1>",
  "deployment_in_progress": false,
  "deployment_vm1_baseline_ready": true,
  "vm1_last_manifest_commit": "<same commit as VM1>"
}
```

If deployment mode is stuck:

```bash
ssh root@<VM2_HOST>
docker ps
docker logs --tail=200 <security_container_name>
curl -sS -X POST "http://127.0.0.1:<SECURITY_PORT>/internal/deployment-mode" \
  -H "X-API-Key: $APP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"in_progress":false}'
```

Only clear deployment mode manually after confirming VM1 and VM2 are on the same intended commit and VM1 has uploaded a current manifest.

## AI Flow

WARDS uses a hybrid AI pipeline:

- Rules and content flags identify suspicious changes.
- Behavioral profile tracks normal admin hours, weekdays, extensions, roots, and source IPs.
- Isolation Forest provides ML anomaly scoring when a trained model exists.
- Confidence fusion limits the ML effect based on profile quality and model freshness.

Core artifacts:

```text
SECURITY/ml/isolation_forest_state.json
SECURITY/ml/isolation_forest_metadata.json
SECURITY/ml_models/isolation_forest.pkl
SECURITY/ml_models/model_metadata.json
```

Inference flow:

1. File, database, or context event arrives.
2. `ai_predict()` builds flags and rule risk.
3. Behavioral profile risk is added.
4. `ml_anomaly_score()` loads the cached Isolation Forest model by mtime.
5. Final score is fused and returned as `normal`, `suspicious`, or `malicious`.

Training flow:

1. `retrain_ai()` reads capped recent admin changes and detections.
2. `build_feature_vector()` creates the stable 28-feature vector.
3. NaN and infinite values are sanitized to zero.
4. Isolation Forest trains when dependencies and enough samples exist.
5. `.pkl` and metadata files are written.
6. Monitored hashes for model artifacts are refreshed so model updates do not create defacement incidents.

Manual retrain:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/ai/retrain" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"actor":"manual_validation"}' | jq
```

Check model files on VM2:

```bash
ssh root@<VM2_HOST>
cd /opt/wards/security/app
ls -lah SECURITY/ml SECURITY/ml_models
sha256sum SECURITY/ml_models/isolation_forest.pkl SECURITY/ml_models/model_metadata.json
```

Test ML score:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/ai/ml-score" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"hour_of_day":3,"day_of_week":6,"file_path":"WARDS/backend/routes/security_dashboard.py","admin_session_valid":0,"vpn_activity":1}' | jq
```

## Recovery Domains

WARDS treats these as independent recovery domains:

- `application_files`: WARDS/OCR monitored files and configuration assets.
- `vm1_database`: primary VM1 database dumps created by VM1 backup engine.
- `vm2_database`: VM2 security database snapshot.
- `ai_ml_assets`: Isolation Forest `.pkl`, behavioral profile JSON, AI state, AI metadata.

Recovery of one domain must not restore another domain unless a full recovery is explicitly requested.

## Backup Flow

Full backups are complete snapshots, but each file in the manifest has a recovery domain. Granular backups remain independent.

Backup metadata includes:

- domain
- backup timestamp
- backup type
- manifest version
- size
- SHA-256
- manifest HMAC

Full recovery does not blindly restore the newest full backup. It selects the newest valid backup independently for each domain.

Validation:

```bash
ssh root@<VM2_HOST>
cd /opt/wards/security/app
find SECURITY/local_backups -name _backup_hashes.json -maxdepth 3 -print | tail
```

Create a full backup:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/backup/full" \
  -H "X-API-Key: <APP_API_KEY>" | jq
```

Create granular backups:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/backup/files" -H "X-API-Key: <APP_API_KEY>" | jq
curl -sS -X POST "https://<VM2_HOST>/v1/backup/database" -H "X-API-Key: <APP_API_KEY>" | jq
curl -sS -X POST "https://<VM2_HOST>/v1/backup/ml" -H "X-API-Key: <APP_API_KEY>" | jq
```

VM1 database backup:

```bash
curl -sS -X POST "https://<VM1_HOST>/api/security/backup/vm1-database" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" | jq
```

VM1 database dumps are pruned to 10 by default. Override with:

```bash
export VM1_DATABASE_BACKUP_RETENTION_LIMIT=20
```

## Incident Recovery Flow

Non-priority files such as `.md` and `.txt`:

- Detection quarantines the modified file.
- No automatic recovery is performed.
- Resolve restores from newest valid trusted backup and deletes quarantine.
- False positive restores or accepts the quarantined/current file, refreshes backup/baseline, and deletes quarantine.

Priority files such as `.html`, `.htm`, `.js`, `.jsx`, `.ts`, `.tsx`, and `.py`:

- Detection quarantines the modified file.
- Automatic recovery restores the trusted content immediately.
- Resolve confirms recovery and deletes quarantine.
- False positive restores the quarantined changed file, refreshes backup/baseline, and deletes quarantine.

VM1 priority files:

- VM2 queues a restore command.
- VM1 reporter polls or receives the command in a manifest response.
- VM1 writes the clean content and acknowledges success.
- VM2 only marks the file clean when it can prove the clean hash.

## Recovery Validation Commands

Check dashboard health:

```bash
curl -sS "https://<VM2_HOST>/v1/dashboard" \
  -H "X-API-Key: <APP_API_KEY>" | jq '.health'
```

List recent incidents:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/detections/query" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"limit":20,"sort":"newest"}' | jq
```

List recoveries:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/recoveries/query" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"limit":20,"sort":"newest"}' | jq
```

Run full recovery:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/recover/full" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"admin_id":1}' | jq
```

Validate VM1 reporter:

```bash
ssh root@<VM1_HOST>
docker ps
docker logs --tail=200 <vm1_reporter_container_name>
curl -sS "https://<VM2_HOST>/v1/vm1/config" -H "X-API-Key: <APP_API_KEY>" | jq
```

Validate VM1 database directly:

```bash
ssh root@<VM1_HOST>
docker exec -i "$(docker ps -q -f name=mysql)" mysqldump -u root -p wards_db citizen_users | head -40
```

Use your production secret source for the MySQL password. Do not paste live passwords into scripts or docs.

## Safe Deployment Smoke Test

After pushing a small code change:

1. Watch VM1 deploy logs:

```bash
ssh root@<VM1_HOST>
journalctl -u webhook-deploy -f
```

2. Watch VM2 SECURITY logs:

```bash
ssh root@<VM2_HOST>
docker logs -f <security_container_name>
```

3. Confirm deployment mode was active during manifest processing:

```bash
curl -sS "http://<VM1_HOST>:9000/vm2-deploy-status" | jq
```

4. Confirm no new deployment-code incidents were created:

```bash
curl -sS -X POST "https://<VM2_HOST>/v1/detections/query" \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"limit":10,"sort":"newest"}' | jq
```

If code-change incidents still appear, check:

- `deployment_in_progress` was true before VM1 changed files.
- `vm1_last_manifest_commit` equals the pushed commit.
- `deployment_vm1_baseline_ready` became true before deployment mode cleared.
- VM1 reporter is running and can reach VM2.
- The changed file is monitorable and not excluded.

## Local Test Commands

Run from the repository root:

```bash
python -m compileall SECURITY scripts tests
python -m pytest tests -q
python -m pytest tests/test_security_engine.py tests/test_incident_resolution.py tests/test_vm1_recovery.py tests/test_monitored_folder_fixes.py tests/test_deployment_hardening.py -q
```
