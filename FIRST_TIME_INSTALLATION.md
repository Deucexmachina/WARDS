# WARDS Masterfile - First Time Installation Guide

This guide is the single setup file for new project members. It replaces the older setup files and assumes the current WARDS Masterfile structure:

```text
WARDS MASTERFILE/
  OCR/
  WARDS/
  SECURITY/
  QUARANTINE/
  DEFACEMENT/
```

`WARDS` is the main system. `OCR` is the receipt/OCR service. `SECURITY` contains the Backup & Recovery/Security Dashboard engine. `QUARANTINE` stores runtime incident copies. `DEFACEMENT` is a development-only external attack simulator and must not be used in final deployment.

## 1. GitHub Setup

Before uploading, confirm that secrets and generated files are ignored. The root `.gitignore` should exclude `.env`, `node_modules`, `venv`, local backups, quarantine files, and generated caches.

Do not upload these:

```text
WARDS/backend/.env
OCR/backend/.env
SECURITY/local_backups/
SECURITY/BACKUPS/
QUARANTINE/
DEFACEMENT/venv/
DEFACEMENT/attack_backups/
WARDS/frontend/node_modules/
OCR/frontend/node_modules/
```

Recommended first upload:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE"
git init
git status
git add .gitignore WARDS/backend/.env.example FIRST_TIME_INSTALLATION.md OCR WARDS SECURITY DEFACEMENT .github docker-compose.yml .dockerignore
git status
git commit -m "Initial WARDS masterfile setup"
git branch -M main
git remote add origin https://github.com/<org-or-username>/<repo-name>.git
git push -u origin main
```

Daily pull before working:

```powershell
git pull origin main
```

Daily push after working:

```powershell
git status
git add .
git commit -m "Describe your change"
git push origin main
```

If Git refuses because someone pushed first:

```powershell
git pull origin main
# resolve conflicts if any
git add .
git commit -m "Resolve merge conflicts"
git push origin main
```

Important: the current local `WARDS/backend/.env` contains real-looking API keys/passwords. It is ignored by Git now, but if those values were ever shared or committed anywhere, rotate them before using the project seriously.

## 2. Required Software

Install these first:

```text
Python 3.11
Node.js 20 LTS or newer
MySQL Server 8.x
MySQL Workbench
Git
Wazuh Agent for Windows
Microsoft Authenticator mobile app
```

Recommended ports:

```text
WARDS frontend: http://localhost:3000
WARDS backend: http://localhost:8000
OCR frontend: http://localhost:3001
OCR backend: http://localhost:8001
DEFACEMENT tester: http://localhost:3010
```

## 3. MySQL Workbench Database Setup

Open MySQL Workbench and create/connect to your local MySQL server connection:

1. Open MySQL Workbench.
2. On the home screen, click the `+` icon beside **MySQL Connections**.
3. Use these recommended local settings:

```text
Connection Name: WARDS Local MySQL
Connection Method: Standard (TCP/IP)
Hostname: 127.0.0.1
Port: 3306
Username: root
Password: Store in Vault... then enter your MySQL root password
```

4. Click **Test Connection**.
5. If the test succeeds, click **OK**.
6. Open the new **WARDS Local MySQL** connection.

Create the database/schema:

```sql
CREATE DATABASE IF NOT EXISTS wards_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

If you already have a project SQL dump, import it through MySQL Workbench:

1. Open the **WARDS Local MySQL** connection.
2. Go to **Server** > **Data Import**.
3. Select **Import from Self-Contained File**.
4. Click `...` and choose the project `.sql` backup/dump file.
5. Under **Default Target Schema**, choose `wards_db`.
6. Click **Start Import**.

If the import fails because there is no target schema:

1. Go back to the SQL editor.
2. Run the `CREATE DATABASE IF NOT EXISTS wards_db` SQL command above.
3. Return to **Server** > **Data Import**.
4. Select **Import from Self-Contained File** again.
5. Choose the `.sql` file again.
6. Select `wards_db` in **Default Target Schema**.
7. Click **Start Import** again.

Create a local project user if you do not want to use `root`:

```sql
CREATE USER IF NOT EXISTS 'wards_user'@'localhost' IDENTIFIED BY 'change_this_password';
GRANT ALL PRIVILEGES ON wards_db.* TO 'wards_user'@'localhost';
FLUSH PRIVILEGES;
```

Recommended `DATABASE_URL` format:

```text
DATABASE_URL=mysql+pymysql://wards_user:change_this_password@localhost:3306/wards_db
```

If you use `root`, the format is:

```text
DATABASE_URL=mysql+pymysql://root:your_mysql_password@localhost:3306/wards_db
```

The WARDS backend creates and updates its tables on startup through SQLAlchemy. The OCR backend also uses the same centralized MySQL database, so use the same database name unless your team intentionally separates it.

## 4. WARDS Backend Setup

Open PowerShell:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

Create your environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

### WARDS Backend `.env` (WARDS/backend/.env)

This is the main system backend. It handles admin authentication, payments, email verification, OCR integration, and the Security Dashboard.

```text
# === Authentication & Security ===
SECRET_KEY=replace-with-a-long-random-secret
ADMIN_SECRET_KEY=replace-with-a-different-long-random-admin-secret

# === Admin Account (created on first startup) ===
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password-immediately
ADMIN_EMAIL=admin@wards.local
SUPERADMIN_EMAIL=superadmin@wards.local
SUPERADMIN_PASSWORD=superadmin123

# === Rate Limiting ===
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=60

# === Server & CORS ===
API_PORT=8000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000
BACKEND_BASE_URL=http://localhost:8000

# === Email (Gmail SMTP for admin notifications) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=your-email@example.com
SMTP_FROM_NAME=WARDS Admin
SMTP_USE_TLS=true

# === External APIs ===
QUICKEMAILVERIFICATION_API_KEY=replace-with-your-api-key
QUICKEMAILVERIFICATION_TIMEOUT_SECONDS=8
PAYMONGO_SECRET_KEY=sk_test_replace_with_your_secret_key
PAYMONGO_PUBLIC_KEY=pk_test_replace_with_your_public_key
LLMWHISPERER_API_KEY=replace-with-your-unstract-llmwhisperer-api-key
LLMWHISPERER_BASE_URL=https://llmwhisperer-api.us-central.unstract.com/api/v2

# === Database ===
DATABASE_URL=mysql+pymysql://wards_user:change_this_password@localhost:3306/wards_db

# === Security Dashboard ===
SECURITY_DEPLOYMENT_MODE=development
SECURITY_MONITORING_ENABLED=false
WAZUH_ENABLED=true
SECURITY_SCAN_INTERVAL_SECONDS=30
```

**Key differences from OCR backend:**

- Contains admin/superadmin account credentials
- Uses Gmail SMTP for admin notifications
- Has PayMongo payment keys
- Has Security Dashboard settings
- Rate limiting configuration

The backend also auto-creates a Superadmin account on startup:

```text
username: superadmin
password: superadmin123
```

For actual deployment, change `SUPERADMIN_PASSWORD` before the first startup or update the account password immediately after setup.

Development mode recommendation:

```text
SECURITY_DEPLOYMENT_MODE=development
SECURITY_MONITORING_ENABLED=false
```

Use this while coding so your own edits are not treated as deployed attacks.

Security testing/deployed mode:

```text
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
```

Use this when testing defacement, automatic scan, quarantine, and recovery. On backend startup, WARDS refreshes the trusted local backup before scans begin, so code changes made while the backend was off become the new clean baseline.

Start backend:

```powershell
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 5. WARDS Frontend Setup

Open a second PowerShell window:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\frontend"
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

Open:

```text
http://localhost:3000
```

## 6. Admin Login and MFA Setup

The main admin account is created from these `.env` values on first backend startup:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_EMAIL
```

Login flow:

1. Open `http://localhost:3000/login`.
2. Choose/sign in as Main Office Admin.
3. If MFA is not set up, WARDS will ask you to set up Microsoft Authenticator.
4. Scan the QR code using Microsoft Authenticator.
5. Enter the current 6-digit authenticator code.
6. After successful login, go to the main admin dashboard.

MFA troubleshooting:

```text
If the 6-digit code fails, set your phone date/time to automatic.
Make sure you are using the newest code, not an expired one.
If the admin account was reset, remove the old WARDS entry from Microsoft Authenticator and scan the new QR code.
If you are locked out during development, reset the MFA secret from the database only with team approval.
```

The Security Dashboard has a second MFA gate:

```text
Main admin login -> Backup & Recovery tab -> Security Dashboard MFA login -> Security Dashboard
```

Opening `http://localhost:3000/admin/backup` directly requires:

```text
Valid main admin login
Fresh second Security Dashboard MFA login
Backend process must still be the same backend session that verified the login
```

If the backend is stopped/restarted, the admin/security session is cleared and the user must log in again.

## 7. Security Dashboard Setup

The Security Dashboard is available at:

```text
http://localhost:3000/admin/backup/login
http://localhost:3000/admin/backup
```

Main features:

```text
Dashboard
File Status
Detection History
Recovery History
Security Incidents
Manual Controls
```

Default monitored folders:

```text
WARDS/
OCR/
```

Not monitored:

```text
SECURITY/
QUARANTINE/
DEFACEMENT/
```

This is intentional. The Security Dashboard should not restore itself, and the defacement tester is development-only.

Manual Controls:

```text
Verify System Integrity
Full System Recovery
Manual Backup
Schedule Automatic Backups
Backup Location
Add monitored folder
Remove monitored folder
Save scan interval
Scheduled AI Retrain
Manual AI Retrain
Show this week's data
Manage AI Rules
```

The automatic scan interval is stored in MySQL, not written back to `.env`. `.env` only provides the default value when settings are first seeded.

## 8. Wazuh Agent Setup

This project uses Wazuh Agent as the local monitoring component. The WARDS security engine still performs the local backup, scan, quarantine, AI scoring, and recovery.

Install Wazuh Agent for Windows.

Do not move the Wazuh installation into the project folder. Keep it in:

```text
C:\Program Files (x86)\ossec-agent
```

Moving it can break the Windows service, permissions, logs, updates, and agent execution.

Edit the agent config as Administrator:

```text
C:\Program Files (x86)\ossec-agent\ossec.conf
```

Use this syscheck section:

```xml
<syscheck>
  <frequency>300</frequency>
  <scan_on_start>yes</scan_on_start>
  <alert_new_files>yes</alert_new_files>
  <directories check_all="yes" realtime="yes" report_changes="yes">C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS</directories>
  <directories check_all="yes" realtime="yes" report_changes="yes">C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\OCR</directories>
  <ignore type="sregex">\\node_modules\\</ignore>
  <ignore type="sregex">\\venv\\</ignore>
  <ignore type="sregex">\\__pycache__\\</ignore>
  <ignore type="sregex">\\dist\\</ignore>
  <ignore type="sregex">\.(log|tmp|pyc|map)$</ignore>
</syscheck>
```

Restart Wazuh Agent:

```powershell
Restart-Service WazuhSvc
Get-Service WazuhSvc
```

Check logs:

```powershell
Get-Content "C:\Program Files (x86)\ossec-agent\ossec.log" -Tail 50
```

If you are using agent-only mode, connection messages about manager ports can appear depending on your Wazuh config. The WARDS project does not require a Wazuh manager for local restore to work, but the full Wazuh platform normally uses a manager for centralized alerts.

Adding/removing monitored folders in the Security Dashboard updates WARDS monitoring and local backup records in MySQL. It does not automatically rewrite `ossec.conf`. If you want Wazuh Agent to watch a new folder too, add that folder manually to `ossec.conf`.

## 9. OCR Setup

Open another PowerShell window:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\OCR\backend"
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

Create OCR `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

### OCR Backend `.env` (OCR/backend/.env)

This is the taxpayer-facing receipt/OCR service. It handles taxpayer verification, OTP emails, and receipt scanning.

```text
# === Database (same as WARDS backend) ===
DATABASE_URL=mysql+pymysql://wards_user:change_this_password@localhost:3306/wards_db

# === OCR API ===
LLMWHISPERER_API_KEY=replace-with-your-unstract-llmwhisperer-api-key
LLMWHISPERER_BASE_URL=https://llmwhisperer-api.us-central.unstract.com/api/v2

# === Email Verification ===
QUICKEMAILVERIFICATION_API_KEY=replace-with-your-api-key

# === Email (Brevo SMTP for taxpayer OTP) ===
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USERNAME=your_brevo_smtp_login
BREVO_SMTP_PASSWORD=your_brevo_smtp_key
BREVO_SENDER_EMAIL=your_verified_sender@example.com
BREVO_SENDER_NAME=WARDS Taxpayer Verification

# === OTP Settings ===
OTP_EXPIRE_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_HASH_SECRET=change_this_random_secret

# === Data Security ===
DATA_HASH_SECRET=change_this_data_hash_secret
DATA_ENCRYPTION_SECRET=change_this_data_encryption_secret

# === Security Phase 2 ===
WARDS_SECURITY_PHASE2_REDACT=true
```

**Key differences from WARDS backend:**

- Uses Brevo SMTP (not Gmail) for taxpayer OTP emails
- Has OTP expiration and cooldown settings
- Has data hashing/encryption secrets for sensitive taxpayer fields
- No admin credentials, PayMongo, or Security Dashboard settings
- Shares `DATABASE_URL` and `LLMWHISPERER_API_KEY` with WARDS backend

**Important:** Both backends must use the same `LLMWHISPERER_API_KEY` and `DATABASE_URL` values.

Start OCR backend:

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

LLMWhisperer OCR notes:

```text
The current Python package is llmwhisperer-client, not unstract-llmwhisperer.
If pip says "No matching distribution found for unstract-llmwhisperer==0.6.3", pull the latest code and reinstall OCR/backend/requirements.txt.
```

Install or repair the OCR dependency:

```powershell
.\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install "llmwhisperer-client>=2.3.1,<2.4.0"
pip install -r requirements.txt
```

The error below means the API key is missing, expired, copied incorrectly, or belongs to the wrong Unstract/LLMWhisperer account:

```text
401 Client Error: Unauthorized for url: https://llmwhisperer-api.us-central.unstract.com/api/v2/whisper
```

Fix:

```text
1. Get a valid LLMWhisperer API key from Unstract.
2. Add the same key to WARDS/backend/.env and OCR/backend/.env:
   LLMWHISPERER_API_KEY=your_valid_key
3. Confirm the endpoint matches your account/region:
   LLMWHISPERER_BASE_URL=https://llmwhisperer-api.us-central.unstract.com/api/v2
4. Remove accidental spaces or quotes around the key.
5. Restart the WARDS backend after editing .env.
6. Retry OCR upload.
```

The branch admin OCR upload is served by the WARDS backend route, so updating only `OCR/backend/.env` is not enough unless `OCR_PROJECT_DIR` points to that folder and the WARDS backend is restarted. The safest setup is to put `LLMWHISPERER_API_KEY` directly in `WARDS/backend/.env`.

The WARDS backend now reads `WARDS/backend/.env` directly for OCR before falling back to `OCR/backend/.env` or Windows environment variables. This prevents an old Windows user/system environment variable from overriding the project key. If OCR still reports a fingerprint that does not match your intended key, remove stale Windows environment values, close PowerShell, reopen it, and restart the backend:

```powershell
[Environment]::SetEnvironmentVariable("LLMWHISPERER_API_KEY", $null, "User")
[Environment]::SetEnvironmentVariable("LLMWHISPERER_API_KEY", $null, "Machine")
```

If the WARDS backend error shows a key fingerprint, compare only that short fingerprint with the start/end of the key you intended to use. Never paste the full key into chat, GitHub issues, screenshots, or documentation. A 401 from LLMWhisperer means the external API rejected the key or endpoint; it is not caused by a MySQL database mismatch.

The OCR backend currently uses Python 3.11 in this project. Newer `llmwhisperer-client` releases require Python 3.12, so the requirements file pins the newest Python 3.11-compatible line: `llmwhisperer-client>=2.3.1,<2.4.0`.

Start OCR frontend:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\OCR\frontend"
npm install
npm run dev -- --host 0.0.0.0 --port 3001
```

## 10. Defacement Tester

The `DEFACEMENT` folder is a separate third-party simulator. It is not part of the final deployment.

Setup:

```powershell
cd "C:\Users\<your-name>\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\DEFACEMENT"
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 3010
```

Open:

```text
http://localhost:3010
```

Visual and CSS defacement both target the WARDS home page path so they are easy to verify:

```text
Visual defacement: WARDS/frontend/src/pages/public/Home.jsx
CSS defacement: WARDS/frontend/src/index.css
```

If the WARDS backend is in deployed monitoring mode, the security engine should detect, quarantine, restore, and log the attack.

Deleting the `DEFACEMENT` folder later must not break WARDS because WARDS imports no modules from it.

## 11. Recommended Local Startup Order

For normal development:

```text
1. Start MySQL
2. Start WARDS backend
3. Start WARDS frontend
4. Start OCR backend/frontend only if needed
5. Keep SECURITY_MONITORING_ENABLED=false while coding
```

For security testing:

```text
1. Stop WARDS backend
2. Finish code changes
3. Set SECURITY_DEPLOYMENT_MODE=deployed
4. Set SECURITY_MONITORING_ENABLED=true
5. Start WARDS backend so it refreshes the clean backup
6. Start WARDS frontend
7. Start DEFACEMENT tester
8. Run attack buttons and watch Security Dashboard logs
```

## 12. Is This Safe To Upload To GitHub?

It is safe to upload only after this checklist is true:

```text
[ ] Root .gitignore exists.
[ ] WARDS/backend/.env is not staged.
[ ] OCR/backend/.env is not staged.
[ ] node_modules folders are not staged.
[ ] venv folders are not staged.
[ ] SECURITY/local_backups and SECURITY/BACKUPS are not staged.
[ ] QUARANTINE is not staged.
[ ] DEFACEMENT/attack_backups is not staged.
[ ] Any real API keys/passwords that were ever exposed have been rotated.
```

Check before committing:

```powershell
git status
git check-ignore -v WARDS/backend/.env
git check-ignore -v OCR/backend/.env
git check-ignore -v SECURITY/BACKUPS
git check-ignore -v QUARANTINE
```

If `git status` shows `.env`, backup folders, quarantine folders, `node_modules`, or `venv`, do not commit yet.

## 13. CI/CD Integration

The project uses GitHub Actions for Continuous Integration. The workflow file is located at:

```text
.github/workflows/wards-ci.yml
```

### What CI Does

On every push or pull request to `main`, GitHub Actions automatically runs:

1. **Backend job**
   - Sets up Python 3.11
   - Installs `WARDS/backend/requirements.txt`
   - Runs syntax checks on `WARDS/backend/main.py` and `SECURITY/security_engine.py`

2. **Frontend job**
   - Sets up Node.js 20
   - Runs `npm ci` in `WARDS/frontend`
   - Runs `npm run build` to verify the production build

### Viewing CI Results

After pushing to GitHub:

1. Go to your repository on GitHub.
2. Click the **Actions** tab.
3. Select the latest workflow run to see build status and logs.

A green checkmark means all checks passed. A red X means a job failed—click into it to see error details.

### CI Troubleshooting

```text
If backend job fails:
  - Check that WARDS/backend/requirements.txt has valid dependencies.
  - Verify main.py and security_engine.py have no syntax errors locally:
    python -m py_compile WARDS/backend/main.py
    python -m py_compile SECURITY/security_engine.py

If frontend job fails:
  - Check that WARDS/frontend/package-lock.json exists and is committed.
  - Verify the build works locally:
    cd WARDS/frontend
    npm ci
    npm run build
```

### CD (Deployment)

CD is documented in `SECURITY/CI_CD_DEPLOYMENT.md` but is not active yet. The planned production path is:

```text
GitHub Actions CI/CD -> Docker -> DigitalOcean -> Cloudflare WAF
```

Docker and DigitalOcean deployment will be configured when the project is ready for production hosting.

## 14. Quick Verification Checklist

```text
[ ] MySQL Workbench shows wards_db.
[ ] WARDS backend starts on port 8000.
[ ] WARDS frontend starts on port 3000.
[ ] Main admin can log in.
[ ] Microsoft Authenticator MFA works.
[ ] Backup & Recovery requires second MFA.
[ ] Security Dashboard opens at /admin/backup.
[ ] Manual Backup succeeds.
[ ] Verify System Integrity reports no changes on a clean system.
[ ] DEFACEMENT visual attack targets Home.jsx.
[ ] DEFACEMENT CSS attack targets index.css and visibly affects the home page.
[ ] Security Incident remains open until admin resolves or marks false positive.
[ ] Recovery History records automatic restoration.
[ ] Wazuh Agent service is running.
```
