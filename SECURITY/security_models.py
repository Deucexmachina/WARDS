from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, Text

from database.models import Base, String


class SecurityMonitoredFile(Base):
    __tablename__ = "security_monitored_files"

    id = Column(Integer, primary_key=True, index=True)
    file_path = Column(String(700), unique=True, nullable=False, index=True)
    relative_path = Column(String(700), nullable=False, index=True)
    folder_root = Column(String(80), nullable=False, index=True)
    baseline_hash = Column(String(128), nullable=False)
    current_hash = Column(String(128), nullable=True)
    status = Column(String(40), default="clean", index=True)
    file_type = Column(String(50), nullable=True)
    size_bytes = Column(Integer, default=0)
    last_checked = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class SecurityDetectionEvent(Base):
    __tablename__ = "security_detection_events"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("security_monitored_files.id"), nullable=True, index=True)
    detected_at = Column(DateTime, default=datetime.utcnow, index=True)
    target_type = Column(String(40), default="file", index=True)
    target_name = Column(String(700), nullable=False, index=True)
    actor = Column(String(255), nullable=True, index=True)
    change_type = Column(String(80), nullable=False, index=True)
    old_hash = Column(String(128), nullable=True)
    new_hash = Column(String(128), nullable=True)
    is_legitimate = Column(Boolean, default=False, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True)
    ai_score = Column(Float, nullable=True)
    ai_prediction = Column(String(40), nullable=True, index=True)
    confidence = Column(Float, nullable=True)
    severity_level = Column(String(40), nullable=True, index=True)
    cvss_score = Column(Float, nullable=True)
    nist_category = Column(String(160), nullable=True)
    enisa_threat_type = Column(String(160), nullable=True)
    trigger_summary = Column(Text, nullable=True)
    accuracy_basis = Column(Text, nullable=True)
    behavior_flags_json = Column(Text, nullable=True)
    changed_lines_json = Column(Text, nullable=True)
    context_json = Column(Text, nullable=True)


class SecurityRecoveryEvent(Base):
    __tablename__ = "security_recovery_events"

    id = Column(Integer, primary_key=True, index=True)
    detection_event_id = Column(Integer, ForeignKey("security_detection_events.id"), nullable=True, index=True)
    file_id = Column(Integer, ForeignKey("security_monitored_files.id"), nullable=True, index=True)
    recovery_type = Column(String(40), nullable=False, index=True)
    initiated_by = Column(Integer, ForeignKey("admins.id"), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(40), default="in_progress", index=True)
    backup_path = Column(String(700), nullable=True)
    quarantine_path = Column(String(700), nullable=True)
    recovery_duration_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)


class SecurityIncident(Base):
    __tablename__ = "security_incidents"

    id = Column(Integer, primary_key=True, index=True)
    detection_event_id = Column(Integer, ForeignKey("security_detection_events.id"), nullable=False, index=True)
    incident_type = Column(String(80), nullable=False, index=True)
    severity_level = Column(String(40), nullable=False, index=True)
    cvss_score = Column(Float, nullable=False)
    cvss_vector = Column(String(220), nullable=True)
    nist_category = Column(String(160), nullable=False)
    enisa_threat_type = Column(String(160), nullable=False)
    status = Column(String(40), default="open", index=True)
    description = Column(Text, nullable=True)
    behaviors_json = Column(Text, nullable=True)
    affected_files_json = Column(Text, nullable=True)
    changed_lines_json = Column(Text, nullable=True)
    quarantine_paths_json = Column(Text, nullable=True)
    response_action = Column(String(80), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(Integer, ForeignKey("admins.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SecurityAdminFileChange(Base):
    __tablename__ = "security_admin_file_changes"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=False, index=True)
    file_path = Column(String(700), nullable=False, index=True)
    change_type = Column(String(80), nullable=False)
    jwt_token_id = Column(String(140), nullable=True, index=True)
    ip_address = Column(String(60), nullable=True)
    user_agent = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)


class SecuritySetting(Base):
    __tablename__ = "security_settings"

    key = Column(String(120), primary_key=True, index=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String(255), nullable=True)

