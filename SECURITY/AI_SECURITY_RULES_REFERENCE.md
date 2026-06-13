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

