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
| Weekly Retraining | Sunday 11:00 PM by default | Retrains with bootstrap data plus legitimate admin file changes from the past 7 days. |
| On-Demand Retraining | After false positives or admin request | Admin clicks Manual AI Retrain in the Security Dashboard. |

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
| method_legitimate | Whether change came through an approved admin workflow. |
| business_hours | Whether change happened during normal working hours. |
| file_type_risk | Risk weight for web/code files. |
| suspicious_pattern_score | Defacement/injection pattern score. |
| vpn_activity | Raises risk but does not automatically mark malicious. |

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

## Recovery Target

Recovery target: 5 minutes or less after a security incident or system failure. Local restore avoids GitHub/API dependency and is limited by disk speed and number of affected files.

Validation measurement:

1. Create a manual backup.
2. Modify or delete one monitored file.
3. Click Verify System Integrity.
4. Confirm detection, quarantine, restore, and Recovery History duration.
5. Full system recovery is accepted if all monitored WARDS/OCR files restore within 5 minutes.

## Current Testing Result Template

| Date | Scenario | Detection Time | Recovery Time | Result | Notes |
|---|---|---:|---:|---|---|
| To be filled during local QA | Visual defacement | TBD | TBD | Pending | Use `DEFACEMENT/index.html` instructions. |
| To be filled during local QA | File deletion | TBD | TBD | Pending | Verify quarantine and restore. |
| To be filled during local QA | False positive | TBD | TBD | Pending | Recovery should show reverted. |
