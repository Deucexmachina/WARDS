# Database Encryption & Hashing Issues (VM1 & VM2)

## VM 1 (App Server — `wards_db`)

### **Field-Level Encryption & Hashing: YES**

The WARDS backend encrypts and hashes sensitive fields before they reach the database.

- **Encryption**: `WARDS/backend/utils/field_crypto.py` uses **Fernet** (AES-128 in CBC mode + HMAC-SHA256) with the `DATA_ENCRYPTION_SECRET` env var.
- **Hashing**: Same file computes **HMAC-SHA256** using `DATA_HASH_SECRET`.
- **Pattern**: Models store triplets for sensitive fields:
  - `field_name` → redacted placeholder (e.g., `CITIZEN_EMAIL_abc123`)
  - `field_name_enc` → encrypted ciphertext
  - `field_name_hash` → HMAC-SHA256 digest

**Affected models/data** (`WARDS/backend/database/models.py`):
- `CitizenUser` — email, full_name, TIN, contact_number, address
- `Payment` — ref_number, txn_id, taxpayer_name, TIN, email, paymongo IDs, proof files, OR numbers
- `BusinessRegistry` — business_name, owner_name, permit numbers, registration numbers
- `TaxAssessmentRecord` — taxpayer_name, email, mobile, address, TDN, property_address
- `TaxpayerIdentifierSubmission` — full_name, email, mobile, address, TDN, permit numbers
- `MFASecret` — portal, username, secret
- `Branch`, `Queue`, `Remittance`, `CollectionAccount`, etc.

### **Password Hashing: YES**
- Admin, branch staff, and citizen passwords are hashed with **bcrypt** via `passlib`.

### **Database-at-Rest Encryption (MySQL TDE): NO**
- There is no Transparent Data Encryption (TDE) or MySQL keyring configuration in `docker-compose.yml` or the MySQL image settings.

### **Connection Encryption (App ↔ DB): NO**
- `WARDS/backend/database/models.py` creates the engine without SSL parameters:
  ```python
  engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
  ```
- The `docker-compose.yml` binds MySQL to `127.0.0.1:3306` (not publicly exposed), but traffic inside the Docker network is **plaintext**.

### **Backup Encryption: NO**
- `WARDS/backend/utils/backup_engine.py` produces `.sql.gz` files with **gzip compression only**.
- It computes a **SHA-256 checksum** for integrity, but the backup itself is not encrypted.
- Notably, `mysqldump` is called with `--skip-ssl`, explicitly disabling SSL for the dump connection.

---

## VM 2 (Security Server — `wards_security_db`)

### **Field-Level Encryption & Hashing: NO**
- `SECURITY/security_models.py` defines security-specific tables (`security_monitored_files`, `security_detection_events`, `security_recovery_events`, `security_incidents`, `security_admin_file_changes`, `security_settings`) **without** `_enc` or `_hash` columns.
- Data like file paths, detection summaries, incident descriptions, and settings are stored **in plaintext**.

### **Password Hashing: Partially**
- VM 2 copies `WARDS/backend/` into its container (`Dockerfile.security`), so shared models like `Admin` (if used) would inherit bcrypt password hashing. But the native security tables do not handle authentication.

### **Database-at-Rest Encryption: NO**
- Standard MySQL 8.0 Docker image with no TDE/keyring configuration.

### **Connection Encryption: NO**
- Uses the same SQLAlchemy engine setup without SSL.

### **Backup Encryption: NO**
- Uses the same backup engine functions as VM 1 (gzipped + checksum, but not encrypted).

---

## Summary

| Layer | VM 1 (`wards_db`) | VM 2 (`wards_security_db`) |
|---|---|---|
| **Field-level encryption** | **Yes** — Fernet (AES-128-CBC) | **No** — plaintext |
| **Field-level hashing** | **Yes** — HMAC-SHA256 | **No** |
| **Password hashing** | **Yes** — bcrypt | Shared code has bcrypt; native security tables don't store passwords |
| **MySQL at-rest encryption (TDE)** | **No** | **No** |
| **App-to-DB SSL/TLS** | **No** | **No** |
| **Backup encryption** | **No** (gzipped + SHA-256 checksum only) | **No** |

---

## Recommended Actions

If you want to harden this, the highest-impact additions would be:

1. **MySQL SSL connections** — add `ssl_ca`, `ssl_cert`, `ssl_key` to `create_engine()`.
2. **Encrypted backups** — encrypt the `.sql.gz` output with a key before writing to disk.
3. **Add field encryption to VM 2 security tables** — apply the same `_enc`/`_hash` pattern to `security_incidents`, `security_detection_events`, etc., if they contain sensitive context.

