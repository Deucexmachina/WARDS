# AI_IMPLEMENTATION.md

## Purpose

This document guides future developers in improving the WARDS Security AI while maintaining alignment with UEBA (User and Entity Behavior Analytics), MITRE ATT&CK, NIST, OWASP, ENISA, CVSS, and Wazuh FIM principles.

## Architecture

Final Risk Score =

1. UEBA Behavioral Anomaly Score (Isolation Forest)
2. Rule-Based Security Score
3. Threat Intelligence Score
4. CVSS-Inspired Severity Weight

## UEBA Behavioral Features (Isolation Forest Inputs)

### IdentityInfo Inspired Features
- admin_session_valid
- admin_role
- mfa_verified
- mfa_method (Microsoft Authenticator)
- session_duration
- account_age_days
- failed_login_count

### BehaviorAnalytics Inspired Features
- hour_of_day
- day_of_week
- business_hours
- ip_consistent
- source_ip_reputation
- vpn_activity
- geo_distance_from_last_login
- first_time_country
- first_time_device

### UserPeerAnalytics Inspired Features
- peer_login_time_deviation
- peer_file_change_deviation
- peer_path_access_deviation
- peer_recovery_action_deviation

### SentinelBehaviorInfo Inspired Features
- method_legitimate
- unauthorized_admin_path
- sensitive_config_change
- backup_restore_activity
- auth_system_modification
- mfa_configuration_change

### SentinelBehaviorEntities Inspired Features
- file_size_change
- content_length
- file_type_risk
- monitored_folder
- file_extension
- file_creation_rate

## Recommended New Rules

| Rule | Reason |
|--------|--------|
| mfa_verified | Validate Microsoft Authenticator usage |
| first_time_device | Common UEBA anomaly |
| first_time_country | Common UEBA anomaly |
| geo_distance_from_last_login | Impossible travel style detection |
| peer_login_time_deviation | UEBA peer comparison |
| peer_path_access_deviation | Detect unusual file access |
| backup_restore_activity | Detect recovery abuse |
| mfa_configuration_change | Protect MFA settings |
| auth_system_modification | Protect authentication modules |
| excessive_file_modifications | Detect mass changes |
| rapid_admin_actions | Detect automation or compromise |

## Keep Existing Rule-Based Security Detection

Do NOT move these into Isolation Forest training:

- suspicious_pattern_score

## Remove Old Rule-Based Security Detection Rules

- external_resource_injection
- phishing_form
- malicious_redirect
- destructive_script
- style_takeover
- ransom_note_keywords

These should be removed or replaced by their UEBA equivalents, so they can be validated. 

## Validation Mapping

UEBA -> Behavioral Features
MITRE ATT&CK -> Attack Mapping
OWASP -> Web Threat Validation
NIST -> Governance and Control Validation
ENISA -> Threat Taxonomy
CVSS -> Severity Scoring
Wazuh -> File Integrity Monitoring

For additional UEBA references:
UEBA Overview link:
https://learn.microsoft.com/en-us/azure/sentinel/identify-threats-with-entity-behavior-analytics
UEBA Identity info link:
https://learn.microsoft.com/en-us/azure/sentinel/ueba-reference#identityinfo-table
UEBA Behavior analytics link:
https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/behavioranalytics
UEBAUser peer analytics link:
https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/userpeeranalytics
UEBA Anomalies link:
https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/anomalies
UEBA Sentinel behavior info link:
https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/sentinelbehaviorinfo
UEBA Sentinel behavior entities link:
https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/sentinelbehaviorentities