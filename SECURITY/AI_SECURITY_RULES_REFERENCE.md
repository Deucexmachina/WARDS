Rule	UEBA Category	Purpose	MITRE/NIST/OWASP	Implementation
hour_of_day	BehaviorAnalytics	Detect unusual access time	MITRE T1078	Isolation Forest
day_of_week	BehaviorAnalytics	Detect unusual weekday activity	MITRE T1078	Isolation Forest
business_hours	BehaviorAnalytics	After-hours detection	OWASP Logging	Isolation Forest
session_duration	IdentityInfo	Abnormal session behavior	NIST AU/IA	Isolation Forest
admin_session_valid	IdentityInfo	Authenticated admin validation	NIST IA	Isolation Forest
mfa_verified	IdentityInfo	Microsoft Authenticator validation	NIST IA	Isolation Forest
ip_consistent	BehaviorAnalytics	Known source validation	OWASP Logging	Isolation Forest
source_ip_reputation	BehaviorAnalytics	Threat intelligence enrichment	Threat Intelligence	Risk Score
vpn_activity	BehaviorAnalytics	VPN/proxy anomaly	OWASP Logging	Risk Score
file_size_change	SentinelBehaviorEntities	Integrity anomaly	MITRE T1491	Isolation Forest
content_length	SentinelBehaviorEntities	Content anomaly	MITRE T1491	Isolation Forest
file_type_risk	SentinelBehaviorEntities	Critical file weighting	Wazuh FIM	Risk Score
unauthorized_admin_path	SentinelBehaviorInfo	Sensitive path protection	MITRE T1491	Rule-Based
sensitive_config_change	SentinelBehaviorInfo	Config integrity	NIST CM/SI-7	Rule-Based
external_resource_injection	SentinelBehaviorInfo	Injected scripts/resources	OWASP A03	Rule-Based
suspicious_pattern_score	SentinelBehaviorInfo	Defacement indicators	MITRE T1491	Rule-Based
phishing_form	SentinelBehaviorInfo	Credential harvesting	OWASP	Rule-Based
malicious_redirect	SentinelBehaviorInfo	Forced redirects	OWASP	Rule-Based
destructive_script	SentinelBehaviorInfo	Client-side disruption	MITRE T1059	Rule-Based
style_takeover	SentinelBehaviorInfo	Visual defacement	MITRE T1491	Rule-Based
backup_restore_activity	SentinelBehaviorInfo	Backup/recovery abuse	NIST Recovery Controls	Rule-Based
mfa_configuration_change	SentinelBehaviorInfo	MFA tamper detection	NIST IA	Rule-Based
auth_system_modification	SentinelBehaviorInfo	Authentication module tamper	MITRE Credential Access	Rule-Based
first_time_device	BehaviorAnalytics	New admin device	UEBA Device Anomaly	Risk Score
first_time_country	BehaviorAnalytics	New admin country	UEBA Location Anomaly	Risk Score
geo_distance_from_last_login	BehaviorAnalytics	Impossible travel	NIST IA / UEBA	Risk Score
keystroke_dynamics	BehaviorAnalytics	Typing rhythm anomaly	UEBA Behavioral Biometrics	Risk Score
admin_action_rarity	BehaviorAnalytics	Out-of-profile admin action	UEBA Insider Admin	Risk Score
restore_frequency	BehaviorAnalytics	Repeated restore abuse	NIST Recovery Controls	Risk Score
backup_integrity_validation	SentinelBehaviorInfo	Backup hash/HMAC failure	NIST Recovery Integrity	Rule-Based
content_similarity_score	SentinelBehaviorEntities	Low similarity content change	UEBA Content Anomaly	Risk Score
affected_files_count	SentinelBehaviorEntities	Mass file modification	UEBA / Wazuh FIM	Risk Score
database_integrity_deviation	SentinelBehaviorInfo	Database audit/snapshot/checksum tamper	NIST Integrity / MITRE Data Manipulation	Rule-Based
ai_model_artifact_tamper	SentinelBehaviorInfo	AI model/state/training tamper	MITRE Defense Evasion	Rule-Based
destructive_command_pattern	SentinelBehaviorInfo	Destructive shell/SQL commands	OWASP Command Injection / MITRE Data Destruction	Rule-Based
webshell_indicator	SentinelBehaviorInfo	Webshell execution primitives	OWASP Web Shell / MITRE Persistence	Rule-Based
session_context_anomaly	BehaviorAnalytics	Session from unusual context	NIST IA / UEBA Session Anomaly	Risk Score
