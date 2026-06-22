# WARDS AI Security Documentation

## Two-VM Architecture

WARDS runs on a **two-VM architecture** that isolates the security stack from the application stack:

| VM | Role | Location | Key Components |
|---|---|---|---|
| **VM 1** | Application Server | `152.42.249.84` | Backend, Frontend, MySQL (`wards_db`), Redis, Wazuh Agent |
| **VM 2** | Security Server | `146.190.97.87` | Security API (FastAPI), AI/ML Engine, Quarantine, MySQL (`wards_security_db`), Backups |

**How the security stack works across VMs:**

1. The security dashboard on VM1 sends requests to VM2 via the `security_client.py` adapter.
2. When `SECURITY_API_URL` is configured on VM1, all security engine calls proxy to VM2 over HTTP (port 8443) with `X-API-Key` authentication.
3. When `SECURITY_API_URL` is empty, the backend falls back to local imports for single-VM or development mode.
4. The AI scoring engine, incident creation, quarantine, backups, and recovery all run on VM2.
5. VM1 can monitor its own files by adding them as **external monitored folders**; VM2 registers these paths and tracks them in `security_monitored_files` with an `EXTERNAL/` prefix.

For full migration details, see `DOCUMENTATION/VM_IMPLEMENTATION.md` and `DOCUMENTATION/DEPLOYMENT_IMPLEMENTATION.md`.

## AI Methodology

WARDS uses a hybrid security analytics architecture combining UEBA behavioral analytics, Isolation Forest-style anomaly profiling, deterministic rule scoring, threat intelligence enrichment, CVSS-inspired severity scoring, and Wazuh File Integrity Monitoring.

Final Risk Score = UEBA Behavioral Anomaly Score + Rule-Based Security Score + Threat Intelligence Score + CVSS-Inspired Severity Weight.

## Isolation Forest and UEBA Feature Set

Retraining writes `SECURITY/ml/isolation_forest_state.json`. The state includes bootstrap normal sample count, historical admin sample count, the active feature list, and a learned behavioral profile containing normal hours, weekdays, source IPs, file roots, and file extensions. `ai_predict()` reads this state during scoring. If a new event falls outside the learned profile and the related AI rule is enabled, the risk score increases and the prediction basis explains which learned behavior was unusual.

Initial sample data is stored in `SECURITY/ml/initial_training_samples.csv`. The backend generates 640 bootstrap normal samples during retraining and appends historical validated admin changes.

| Feature | UEBA Area | Meaning |
|---|---|---|
| hour_of_day | BehaviorAnalytics | Time the change or admin action was detected. |
| day_of_week | BehaviorAnalytics | Weekday/weekend behavior pattern. |
| session_duration | IdentityInfo | Estimated authenticated admin session age. |
| file_size_change | SentinelBehaviorEntities | Byte difference from the clean backup copy. |
| content_length | SentinelBehaviorEntities | New file length. |
| special_chars_count | SentinelBehaviorEntities | Count of code-like or injection-friendly characters. |
| admin_session_valid | IdentityInfo | Whether a WARDS admin JWT/MFA session was present. |
| mfa_verified | IdentityInfo | Whether Microsoft Authenticator MFA was verified. |
| ip_consistent | BehaviorAnalytics | Whether the source IP matches normal admin behavior. |
| source_ip_reputation | Threat Intelligence | AbuseIPDB/blocklist confidence and reputation signals. |
| keystroke_dynamics | BehaviorAnalytics | Optional typing-pattern anomaly signal supplied by context. |
| method_legitimate | SentinelBehaviorInfo | Whether change came through an approved admin workflow. |
| business_hours | BehaviorAnalytics | Whether change happened during expected working hours. |
| file_type_risk | SentinelBehaviorEntities | Risk weight for web/code files. |
| suspicious_pattern_score | OWASP/MITRE Rule | Deterministic defacement, injection, credential, or SQL pattern score. |
| vpn_activity | Threat Intelligence | Raises risk for proxy/VPN/hosting signals without automatic malicious classification. |
| first_time_device | BehaviorAnalytics | Detects device anomalies when context shows an unseen admin device. |
| first_time_country | BehaviorAnalytics | Detects country anomalies when context shows an unseen source country. |
| geo_distance_from_last_login | BehaviorAnalytics | Detects impossible-travel style distance/time anomalies. |
| unauthorized_admin_path | SentinelBehaviorInfo | Detects sensitive admin/auth/security path changes outside approved workflows. |
| sensitive_config_change | SentinelBehaviorInfo | Detects environment, Wazuh, dependency, and database configuration changes. |
| backup_restore_activity | SentinelBehaviorInfo | Detects backup, restore, quarantine, and recovery path activity. |
| mfa_configuration_change | SentinelBehaviorInfo | Detects MFA/authenticator/two-factor configuration changes. |
| auth_system_modification | SentinelBehaviorInfo | Detects authentication, authorization, token, password, session, and middleware changes. |
| admin_action_rarity | UEBA InsiderAdmin | Raises risk when an administrator modifies paths or performs actions outside the learned admin profile. |
| restore_frequency | UEBA RecoveryLoop | Raises risk when repeated restore operations suggest a recovery abuse loop. |
| backup_integrity_validation | UEBA BackupIntegrity | Blocks recovery risk acceptance when backup hash validation fails before restoration. |
| content_similarity_score | UEBA ContentAnomaly | Raises risk when modified content is substantially different from the approved baseline even if length is similar. |
| affected_files_count | UEBA MassModification | Raises risk when many protected files are modified in a short time window. |

## Default AI Rules

These rules are enabled by default because they directly protect admin identity, sensitive security files, recovery workflows, and high-confidence web tampering indicators.

| Rule | Status | Primary Validation |
|---|---|---|
| admin_session_valid | Default | NIST unauthorized access governance and UEBA identity assurance. |
| mfa_verified | Default | UEBA IdentityInfo and Microsoft Authenticator assurance. |
| first_time_device | Default | UEBA device anomaly detection. |
| first_time_country | Default | UEBA location anomaly detection. |
| geo_distance_from_last_login | Default | UEBA impossible travel detection. |
| unauthorized_admin_path | Default | Wazuh FIM plus NIST privileged path protection. |
| sensitive_config_change | Default | Wazuh FIM plus configuration integrity validation. |
| backup_restore_activity | Default | NIST recovery control abuse detection. |
| mfa_configuration_change | Default | Identity protection and MFA tamper detection. |
| auth_system_modification | Default | MITRE ATT&CK credential/access defense mapping. |
| admin_action_rarity | Default | UEBA insider admin detection for anomalous actions. |
| restore_frequency | Default | UEBA recovery loop detection for repeated restore abuse. |
| backup_integrity_validation | Default | Backup integrity check before recovery acceptance. |
| content_similarity_score | Default | UEBA semantic content change detection. |
| affected_files_count | Default | UEBA mass modification detection for rapid file changes. |
| suspicious_pattern_score | Default | OWASP injection/defacement indicators and MITRE malicious code mapping. |
| vpn_activity | Default | Threat intelligence and UEBA source anomaly enrichment. |
| source_ip_reputation | Default | AbuseIPDB reputation and threat intelligence enrichment. |
| keystroke_dynamics | Default | Optional UEBA behavior signal when supplied by caller context. |

## Manual Add AI Rules

Lower-confidence or context-dependent UEBA peer/rate rules are available from Manual Controls > Manage AI Rules. Admins can add only approved templates so arbitrary incompatible rules cannot be introduced.

| Optional Rule | Validation Basis | Initial Sample Type |
|---|---|---|
| peer_login_time_deviation | UEBA UserPeerAnalytics login-time comparison. | Admin login time outside peer baseline. |
| peer_path_access_deviation | UEBA UserPeerAnalytics path-access comparison. | Admin edited paths outside peer baseline. |
| excessive_file_modifications | UEBA entity velocity and Wazuh FIM change-rate signal. | Multiple protected files modified in a short window. |
| rapid_admin_actions | UEBA privileged-action velocity signal. | Repeated privileged actions faster than normal. |

## Removed Temporary Rules

The following temporary Add AI Rules button templates and their sample data were removed from the active engine and training data: `external_resource_injection`, `phishing_form`, `malicious_redirect`, `destructive_script`, `style_takeover`, and `ransom_note_keywords`.

## Global AI Sensitivity

WARDS uses a global AI sensitivity setting that controls the overall detection threshold across all AI rules. This replaces per-rule sensitivity controls to provide consistent behavior and simpler configuration.

| Sensitivity Level | Threshold | Description |
|---|---|---|
| Low | 0.85 | Fewer false positives, may miss some anomalies. |
| Medium | 0.70 | Balanced detection (default). |
| High | 0.55 | More aggressive detection, may increase false positives. |
| Very High | 0.40 | Maximum sensitivity, highest false positive rate. |

The global sensitivity is applied in `ai_predict()` when determining whether the final risk score crosses the malicious prediction threshold. Admins can adjust this setting from Manual Controls > Manage AI Rules > Global AI Sensitivity.

## VPN and Risk-Only Detection

VPN detection enriches AI context with `vpn_detected`, `vpn_activity`, `vpn_provider`, `vpn_risk_score`, `vpn_signals`, and full `vpn_detection` metadata. Local/private addresses are ignored. AbuseIPDB is used when configured, and public geolocation/provider data is checked best-effort.

Risk-only detections are stored in `security_detection_events` even when no incident is created. Examples include VPN/proxy login, invalid admin session, after-hours activity, keystroke anomaly, suspicious IP reputation, MFA-not-verified activity, first-time device/country, impossible travel, or sensitive path activity that does not include concrete tamper evidence.

Incident creation is intentionally stricter than detection logging. WARDS creates a Security Incident when the file is deleted, the AI prediction is malicious, concrete tamper evidence exists (`script_injection`, `iframe_injection`, `defacement_keywords`, `credential_access`, `sql_injection`), or the CVSS-style score reaches high severity.

## Validation Basis

| Reference | Use in WARDS |
|---|---|
| NIST SP 800-61 Rev. 2 | Incident categories, handling, recovery, and unauthorized access governance. |
| FIRST CVSS v3.1 | Severity score and vector labels shown in incidents. |
| ENISA Threat Taxonomy | Threat labels such as web application attack and information manipulation. |
| Wazuh File Integrity Monitoring | FIM monitoring for file creation, modification, and deletion. |
| scikit-learn IsolationForest | Unsupervised anomaly detection model used for implementation planning. |
| Liu, Ting, and Zhou, Isolation Forest, ICDM 2008 | Research basis for isolation-based anomaly detection. |
| UEBA / Microsoft Sentinel behavior concepts | Identity, behavior, peer, behavior entity, and sensitive action features. |
| OWASP | Web attack validation for injection, credential, and tampering indicators. |
| MITRE ATT&CK | Mapping for credential access, persistence, malicious code, and defense evasion behavior. |

## Automatic Recovery Process

Security incidents trigger an automatic recovery process based on file type risk and severity level. The recovery engine on **VM2** evaluates each detection at incident creation time and decides whether to auto-recover without admin input. Quarantine, backups, and restored files all live on VM2's filesystem under `/opt/wards/app/QUARANTINE/` and `/opt/wards/app/SECURITY/local_backups/`.

**Important:** Recovery requires a prior backup to exist on VM2. If a file was never backed up (e.g., a new upload that has not yet been included in a manual or automatic backup), recovery will fail with "Backup copy not found." Always ensure backups are created before relying on automatic recovery.

### High-Risk File Auto-Recovery

Files with the following extensions are considered **high-risk** and will **always** trigger automatic recovery when a security incident is created:

| Extension | Risk Reason |
|---|---|
| `.html` | Web-facing content, defacement target |
| `.jsx` | React component, injection vector |
| `.js` | Executable client-side script |
| `.py` | Server-side executable code |

When a high-risk file is modified outside an approved workflow and a security incident is logged, the system immediately:
1. Copies the current (potentially defaced) file to quarantine
2. Restores the file from the latest trusted backup
3. Updates the monitored file entry to `recovered` status
4. Creates a recovery event with type `automatic`

### Severity-Based Auto-Recovery for Non-High-Risk Files

Files that are **not** in the high-risk extension list do **not** auto-recover by default. They only trigger automatic recovery if the incident severity is **high or above** (`severity_level` >= `high`).

This ensures that low-severity incidents on non-executable files (such as image uploads or text documents) do not disrupt operations, while still protecting critical infrastructure from high-confidence threats.

### Incident Status Effects on Recovery

| Status | High-Risk File (Already Recovered) | Non-High-Risk File (Not Recovered) |
|---|---|---|
| **Resolved** | Defaced file deleted from quarantine. No additional recovery triggered. Incident closed. | Defaced file deleted from quarantine. Recovery process triggered first, then backup process triggered to prevent duplicate interval detections. |
| **False Positive** | Recovery is reverted. Defaced file moved from quarantine to replace the recovered file (authorized change accepted). Backup triggered to update baseline. | No recovery exists to revert. Only backup process triggered to update baseline and prevent duplicate detections. |
| **Investigating** | Functionally identical to **Open**. The incident remains active and recovery state is unchanged. Admin has simply acknowledged viewing it. |

**Note**: For both Resolved and False Positive transitions, the backup process updates the trusted baseline so the same file change does not re-trigger on the next scan interval.

## Monitored Folders

Admins can add or remove folders from file integrity monitoring through the security dashboard or API.

### Adding a Monitored Folder

When a folder is added:
1. The path is validated to exist on the target VM
2. All files within the folder matching monitored suffixes are registered in `security_monitored_files`
3. Baseline hashes are computed from the current file contents
4. Files are included in subsequent scans and backups

### Removing a Monitored Folder

When a folder is removed:
1. Files in that folder are marked with status `monitoring_removed`
2. They are excluded from future scans
3. Existing backup copies are retained for historical recovery

### VM1 Monitored Folders (External Monitoring)

Folders on VM1 (the application server) can be monitored by the security engine on VM2. When adding a VM1 folder, the path is stored with an `EXTERNAL/` prefix in `security_monitored_files`. The security engine resolves these paths using the `MONITORED_ROOTS` mapping on VM2. The actual file content lives on VM1, but the security tracking, quarantine, and backups are managed by VM2.

- The path must be an absolute path that exists on VM1.
- Remote folder browsing is not yet available; admins must type the full path manually.
- When VM2 registers these files, it stores a relative path such as `EXTERNAL/VM1_{hash}/opt/wards/app/test/test.txt`.
- File hash comparisons and recovery decisions happen on VM2; the engine uses `portable_monitored_path()` to locate the actual file.

## Testing Workflow

The following SSH-based workflow validates resolve, false positive, and monitored folder behavior end-to-end.

### Prerequisites

- SSH access to VM1 (`ssh root@152.42.249.84` or `ssh wards-vm1`)
- Admin access to the WARDS security dashboard at `/admin/backup`

### Step 1 — Create Test Folder and File on VM1

```bash
ssh root@152.42.249.84
cd /opt/wards/app
mkdir -p test
echo "THIS IS UNEDITED" > test/test.txt
cat test/test.txt
```

Expected output:
```
THIS IS UNEDITED
```

### Step 2 — Add Folder to Monitoring

1. Open the WARDS security dashboard (`/admin/backup`)
2. Navigate to **Monitored Folders**
3. Click **Add monitored folder**
4. Enter `/opt/wards/app/test` and confirm
5. Verify the folder appears in the monitored folders list

Alternatively, trigger a manual system scan to auto-register the folder if it is inside an already-monitored root.

### Step 3 — Simulate Unauthorized Change via SSH

This simulates a change made outside the approved admin workflow (no GitHub session token, no web UI).

```bash
ssh root@152.42.249.84
cd /opt/wards/app/test
echo "THIS IS HACKED" > test.txt
cat test.txt
```

Expected output:
```
THIS IS HACKED
```

### Step 4 — Trigger Scan and Verify Detection

1. In the security dashboard, click **Manual System Scan** or wait for the next automatic scan interval
2. Check the detection logs for `test/test.txt`
3. Verify a security incident was created with the correct severity

### Step 5 — Test Resolve

1. Open the security incident for `test/test.txt`
2. Click **Mark as Resolved**
3. Observe behavior based on file type:
   - If `.txt` (non-high-risk) and severity was **low/medium**: recovery is triggered, then backup is triggered
   - If high-risk or high+ severity: the already-recovered file stays in place, quarantine copy is deleted

### Step 6 — Test False Positive

1. Repeat Step 3 to re-deface the file
2. After scan creates a new incident, click **Mark as False Positive**
3. Observe behavior:
   - If high-risk (already auto-recovered): recovery is reverted, quarantined defaced file replaces the recovered version, backup is triggered
   - If non-high-risk (not recovered): only backup is triggered to accept the change as authorized

### Step 7 — Check for Duplicate Detections

After resolving or marking false positive, wait for the next scan interval or trigger a manual scan. Verify that **no duplicate incident** is created for the same file. The backup baseline update should prevent re-detection.

### Checking the Scan Interval

To view the current automatic scan interval configured on VM2:

```bash
ssh root@146.190.97.87
cd /opt/wards/app
# Check environment variable
grep SECURITY_SCAN_INTERVAL_SECONDS .env 2>/dev/null || echo "Not set in root .env"
# Or check inside the security-api container
docker compose -f docker-compose.security.yml exec security-api sh -c 'echo $SECURITY_SCAN_INTERVAL_SECONDS'
```

The default interval is `30` seconds in development and typically `300` seconds (5 minutes) in production when `SECURITY_DEPLOYMENT_MODE=deployed` and `SECURITY_MONITORING_ENABLED=true`. The interval is controlled by the `SECURITY_SCAN_INTERVAL_SECONDS` environment variable in VM2's `.env` or `docker-compose.security.yml`.

## Runtime Frequency

The security dashboard runs when an admin opens `/admin/backup` on the VM1 frontend. All dashboard data is fetched from VM2 via the `security_client.py` adapter. Manual scans happen when the admin clicks **Manual System Scan** or scans an individual file; these requests are proxied to VM2's `/v1/scan/all` or `/v1/scan/file/{id}` endpoints.

Wazuh agents can perform continuous FIM on both VMs while deployed:
- **VM1** watches `/opt/wards/app/WARDS/` and `/opt/wards/app/OCR/`.
- **VM2** watches `/opt/wards/app/SECURITY/` and `/opt/wards/app/QUARANTINE/`.

Automatic background scanning runs on VM2 and should be enabled only for deployed environments by setting on VM2:

```env
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
WAZUH_ENABLED=true
SECURITY_SCAN_INTERVAL_SECONDS=300
```

On VM1, the backend must also be configured to reach VM2:

```env
SECURITY_API_URL=http://146.190.97.87:8443
SECURITY_API_KEY=your-shared-api-key
```

## Account-Based Rate Limiting and Temporary Restrictions

WARDS has migrated from IP-based to account-based rate limiting and strike enforcement. This provides more precise targeting and avoids penalizing legitimate users sharing an IP address.

### Rate Limiting Mechanics

- **Account Identification**: JWT tokens are decoded to extract `user_id`, `role`, and `type` (citizen, branch, admin, superadmin).
- **Violation Tracking**: Each rate limit violation is recorded per account with detection type and timestamp.
- **Strike Conversion**: Every 3 rate limit violations equals 1 strike.
- **Strike Levels**:
  - Strike 1: Warning logged
  - Strike 2: Audit event generated for privileged accounts
  - Strike 3: Temporary restriction applied (default 900 seconds / 15 minutes)
  - Strike 4+: Extended restriction duration

### Detection Types

Rate limit violations are categorized by detection type:
- Rate Limit Abuse Detected
- Repeated Queue Request Abuse
- Excessive Portal Requests
- Repeated Administrative Abuse

### Temporary User Restrictions

Admins can manually apply temporary user restrictions from Manual Controls > Blocked IPs > Temporary User Restriction. This allows immediate account-level enforcement without affecting other users on the same IP.

**Restriction Parameters**:
- `account_id`: The user identifier (ID, username, or email depending on account type)
- `account_type`: citizen, branch, main admin, or super admin
- `scope`: manual, rate_limit, or other restriction source
- `duration`: Restriction duration in seconds (60-604800, default 900)
- `reason`: Human-readable explanation for the restriction

**Restriction Enforcement**:
- Restricted accounts receive a 429 Too Many Requests response with restriction details
- The middleware checks for active restrictions before processing requests
- Restrictions automatically expire after the duration elapses
- All restrictions are logged to `activity_logs` for audit purposes

### Backend Endpoints

- `POST /security/user-restrictions`: Add a manual temporary user restriction
- `GET /security/user-restrictions`: List currently active user restrictions
- Rate limit state is managed in-memory in `middleware.dos_protection.account_rate_limit_state`
