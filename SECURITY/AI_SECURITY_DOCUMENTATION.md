# WARDS Security AI Documentation

## Scope

The Security Dashboard protects the production `WARDS` and `OCR` folders. The `SECURITY` folder is excluded from monitoring so the system does not try to restore the code that performs restoration. Defaced or suspicious copies are stored in `QUARANTINE`, then the live file is restored from a local backup folder selected by the admin.

## AI Approach

Architecture: Weekly Incremental Retraining with Wazuh-fed data.

Model: Isolation Forest style anomaly detection trained on normal administrative behavior. The first deployment uses synthetic normal admin behavior data, then weekly retraining adds rows from the `security_admin_file_changes` table.

Training phases:

| Phase | When | What Happens |
|---|---|---|
| Initial Training | Deployment | Generates 640 normal admin samples and stores training metadata in `SECURITY/ml/isolation_forest_state.json`. |
| Weekly Retraining | Sunday 11:00 PM by default | Retrains with bootstrap data plus all historical legitimate admin file changes. |
| On-Demand Retraining | After false positives or admin request | Admin clicks Manual AI Retrain in the Security Dashboard. |

Retraining writes `SECURITY/ml/isolation_forest_state.json`. The state includes the bootstrap sample count, historical admin sample count, feature list, and a learned behavioral profile containing normal hours, weekdays, source IPs, file roots, and file extensions. `ai_predict()` reads that state during scoring. If a new event falls outside the learned profile and the related AI rule is enabled, the risk score increases and the prediction basis explains which learned behavior was unusual.

Feature vector:

| Feature | Meaning |
|---|---|
| hour_of_day | Time the change was detected. |
| day_of_week | Monday to Sunday behavior pattern. |
| session_duration | Estimated authenticated admin session age. |
| file_size_change | Byte difference from the clean backup copy. |
| content_length | New file length. |
| special_chars_count | Count of code-like or injection-friendly characters. |
| admin_session_valid | Whether a WARDS admin JWT/MFA session was present. |
| ip_consistent | Whether source looks consistent with normal admin use. |
| source_ip_reputation | AbuseIPDB confidence score, report count, and suspicious source metadata when available. |
| keystroke_dynamics | Optional typing-pattern anomaly signal supplied by the calling context. |
| method_legitimate | Whether change came through an approved admin workflow. |
| business_hours | Whether change happened during normal working hours. |
| file_type_risk | Risk weight for web/code files. |
| suspicious_pattern_score | Defacement/injection pattern score. |
| vpn_activity | Raises risk but does not automatically mark malicious. |
| unauthorized_admin_path | Raises risk when admin/auth/security paths change outside approved workflows. |
| sensitive_config_change | Raises risk for `.env`, Wazuh, dependency, and database configuration files. |
| external_resource_injection | Raises risk for newly introduced remote scripts, forms, fetches, or links. |

## VPN and Risk-Only Detection

VPN detection is now active instead of only context-dependent. When a source IP is available, WARDS runs `services.vpn_detection.detect_vpn()` and enriches the AI context with:

| Field | Meaning |
|---|---|
| vpn_detected / vpn_activity | True when proxy/VPN/hosting signals are found. |
| vpn_provider | ISP, organization, domain, or ASN/provider name when available. |
| vpn_risk_score | 0-100 score from AbuseIPDB metadata, proxy flags, hosting flags, and provider keywords. |
| vpn_signals | Concrete signals such as AbuseIPDB score, proxy flag, hosting flag, or provider keyword. |
| vpn_detection | Full detector result including country/city/provider/source/error fields. |

Detection sources:

1. Local IP classification skips private, loopback, link-local, reserved, multicast, and unspecified addresses.
2. AbuseIPDB is used when `ABUSEIPDB_API_KEY` is configured. Abuse confidence and usage/provider metadata raise risk.
3. A best-effort public IP lookup checks geolocation, proxy, hosting, and provider fields. If this service is unavailable, scanning continues without blocking.
4. Provider keyword detection flags common VPN/proxy/cloud/datacenter terms.

Risk-only detections are stored in `security_detection_events` even when no incident is created. Examples include VPN/proxy login, invalid admin session, after-hours activity, keystroke anomaly, suspicious IP reputation, or a sensitive admin path signal that does not include concrete defacement/tampering evidence. These records appear in Detection History and use per-admin unread state like other security logs.

Incident creation is intentionally stricter than detection logging. WARDS creates a Security Incident when the file is deleted, the AI prediction is malicious, concrete tamper evidence exists (`script_injection`, `iframe_injection`, `defacement_keywords`, credential/SQL/ransom/redirect/phishing/style takeover/external resource injection), or the CVSS-style score reaches high severity. VPN use by itself raises risk and creates a detection log, but it does not automatically quarantine or restore files.

Admin login paths feed the same risk detector. Successful admin logins can create risk-only detection logs when VPN/proxy, after-hours, reputation, or similar rules trigger. Invalid or expired admin tokens create `invalid_admin_session` detections.

Approved optional rules can be added from Manual Controls > Manage AI Rules. These are selected from a fixed defacement dictionary so admins cannot create arbitrary incompatible rules. Each added rule includes initial sample patterns and can be enabled, disabled, and tuned like the default rules.

| Optional Rule | Validation Dictionary Basis | Initial Sample Type |
|---|---|---|
| ransom_note_keywords | Ransom/extortion phrases such as encrypted files, ransom payment, bitcoin wallet, decrypt key. | Ransom note text snippets. |
| malicious_redirect | Forced redirect patterns such as `window.location`, `location.href`, and meta refresh. | Redirect code snippets. |
| destructive_script | Browser disruption patterns such as local/session storage clearing and DOM removal. | JavaScript disruption snippets. |
| phishing_form | Fake login/account warning wording. | Phishing text snippets. |
| style_takeover | Full-page overlay and CSS takeover patterns. | CSS overlay snippets. |

Initial sample data is in `SECURITY/ml/initial_training_samples.csv`. The backend also generates 640 bootstrap samples during retraining.

## Validation Basis

The design is aligned with these references:

| Reference | Use in WARDS |
|---|---|
| NIST SP 800-61 Rev. 2, Computer Security Incident Handling Guide: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r2.pdf | Incident categories such as malicious code, denial of service, improper usage, and unauthorized access. |
| FIRST CVSS v3.1 Specification: https://www.first.org/cvss/v3.1/specification-document | Severity score from 0.0 to 10.0 and vector labels shown in incidents. |
| ENISA Threat Taxonomy: https://www.enisa.europa.eu/topics/threat-risk-management | Threat labels such as web application attack and information manipulation. |
| Wazuh File Integrity Monitoring docs: https://documentation.wazuh.com/current/user-manual/capabilities/file-integrity/index.html | FIM monitoring for file creation, modification, and deletion. |
| scikit-learn IsolationForest docs: https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html | Unsupervised anomaly detection model used for implementation planning. |
| Liu, Ting, and Zhou, Isolation Forest, ICDM 2008 | Research basis for isolation-based anomaly detection. |

## Runtime Frequency

The dashboard runs when an admin opens `/admin/backup`. Manual scans happen when the admin clicks Verify System Integrity or scans an individual file. Wazuh can perform continuous FIM while deployed. Automatic background scanning should be enabled only for deployed environments by setting:

```env
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
WAZUH_ENABLED=true
```

During normal development, leave monitoring disabled and use manual scans. This prevents constant detection logs while files are being edited.

## Log Notification Semantics

Security Dashboard log unread counts are stored per admin in `security_log_views`. Reading logs as one admin does not mark them read for other admins. Detection, backup, and recovery badges count only unread logs. Security incident badges count open or investigating incidents and remain visible after the incident is read; the incident popup count only drops when the incident is resolved or marked false positive.

Main Admin System Alerts are durable rows in `alerts`. Security backups, manual recoveries, risk-only detections, VPN/invalid-session detections, incident resolution, false-positive handling, and security incidents generate summaries. Security incidents generate one alert per incident (`SEC-{id}`) containing both the detection summary and the related automatic recovery summary to avoid duplicate alert spam.

Current security alert catalog:

| Alert key | Dashboard title | When it is generated |
| --- | --- | --- |
| backup_started | Security Backup Started | A manual, scheduled, startup, initial, or false-positive baseline backup begins. |
| backup_completed | Security Backup Completed | A backup finishes successfully. |
| backup_failed | Security Backup Failed | A backup fails or times out. |
| detection_logged | Security Detection Logged | A suspicious risk-only detection is recorded without opening an incident. |
| recovery_completed | Security Recovery Completed | A manual or automatic recovery completes successfully. |
| recovery_failed | Security Recovery Failed | A recovery attempt fails. |
| incident_created | Security Incident Logged | A concrete deletion, malicious prediction, tamper, defacement, injection, or high-CVSS event opens a security incident. |
| incident_resolved | Security Incident Resolved | An admin marks an incident resolved. |
| incident_false_positive | Security Incident Marked False Positive | An admin marks an incident false positive. |
| vpn_risk | VPN/Proxy Risk Detected | VPN/proxy or hosting signals raise an admin-session risk score. |
| invalid_admin_session | Invalid Admin Session Detected | An expired, invalid, or malformed admin session is detected. |

## Recovery Target

Recovery target: 5 minutes or less after a security incident or system failure. Local restore avoids GitHub/API dependency and is limited by disk speed and number of affected files.

Validation measurement:

1. Create a manual backup.
2. Modify or delete one monitored file.
3. Click Verify System Integrity.
4. Confirm detection, quarantine, restore, and Recovery History duration.
5. Full system recovery is accepted if all monitored WARDS/OCR files restore within 5 minutes.

## Incident Finalization Workflows

Resolved incident:

1. The suspicious file is quarantined and the trusted backup is restored during automatic response.
2. An admin marks the incident resolved after confirming the change was malicious.
3. WARDS keeps the restored clean file, removes the incident quarantine folder, updates file status, and does not create a new backup because the live file matches the trusted baseline.
4. If the quarantined copy was already deleted, WARDS asks for confirmation and then proceeds because resolving a threat was going to remove quarantine anyway.

False positive:

1. The suspicious file is quarantined and the trusted backup is restored during automatic response.
2. An admin marks the incident false positive after confirming the quarantined change was legitimate.
3. WARDS copies the quarantined file back to its original location, removes the quarantine folder, marks the detection legitimate, marks related recoveries reverted, and refreshes the backup baseline so the legitimate change is protected going forward.
4. If the quarantined file is missing, WARDS asks for confirmation. If the admin continues, no reversion or backup occurs and the current file state is left unchanged.
5. Bulk false-positive actions perform the same per-incident reversion and then create one consolidated backup.

## Current Testing Result Template

| Date | Scenario | Detection Time | Recovery Time | Result | Notes |
|---|---|---:|---:|---|---|
| To be filled during local QA | Visual defacement | TBD | TBD | Pending | Use `DEFACEMENT/index.html` instructions. |
| To be filled during local QA | File deletion | TBD | TBD | Pending | Verify quarantine and restore. |
| To be filled during local QA | False positive | TBD | TBD | Pending | Recovery should show reverted. |
