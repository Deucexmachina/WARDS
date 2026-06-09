# WARDS AI Security Documentation

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

## Runtime Frequency

The dashboard runs when an admin opens `/admin/backup`. Manual scans happen when the admin clicks Manual System Scan or scans an individual file. Wazuh can perform continuous FIM while deployed. Automatic background scanning should be enabled only for deployed environments by setting:

```env
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
WAZUH_ENABLED=true
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
