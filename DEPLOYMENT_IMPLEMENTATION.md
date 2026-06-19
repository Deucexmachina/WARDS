# WARDS DigitalOcean Deployment Implementation

This guide deploys WARDS on **two DigitalOcean Ubuntu droplets** using Docker Compose, MySQL, Redis, the FastAPI backend, the built React frontend, and optional Wazuh agent monitoring.

- **VM 1 (App Server):** WARDS backend, frontend, OCR, MySQL (business tables), Redis, Wazuh agent.
- **VM 2 (Security Server):** Security API, AI/ML engine, quarantine storage, MySQL (security tables), Wazuh agent.

For the full two-VM migration guide, see `VM_IMPLEMENTATION.md`.

## 1. Prepare DigitalOcean

1. **Create two Ubuntu 22.04 or 24.04 droplets:**
   - **VM 1 (App):** 2 vCPU, 4 GB RAM, 80 GB disk.
   - **VM 2 (Security):** 1 vCPU, 2 GB RAM, 40 GB disk (separate account or region for blast-radius isolation).
2. Add your SSH key during droplet creation.
3. In the DigitalOcean firewall for **VM 1**, allow:
   - SSH: `22` from your team IPs only.
   - Frontend: `3000` from all IPv4/IPv6.
   - Backend API: `8000` from all IPv4/IPv6.
   - Webhook deployer: `9000` from GitHub IPs (or all, protected by signature verification).
   - MySQL and Redis: do not expose publicly.
4. In the firewall for **VM 2**, allow:
   - SSH: `22` from your team IPs only.
   - Security API: `8443` from VM 1 IP only.
   - Block all other inbound traffic.

Without a domain, your temporary URLs are:

```text
Frontend: http://DROPLET_PUBLIC_IP:3000
Backend API: http://DROPLET_PUBLIC_IP:8000
Health check: http://DROPLET_PUBLIC_IP:8000/api/health
```

### What is DROPLET_PUBLIC_IP?

`DROPLET_PUBLIC_IP` is the IPv4 address assigned to your DigitalOcean droplet. You can find it in:
- The DigitalOcean dashboard under your droplet's name.
- The droplet's networking tab.
- It looks like `192.0.2.1` or similar.

Replace every occurrence of `DROPLET_PUBLIC_IP` in commands and config files with your actual droplet IP before running them.

## 2. Install Server Packages

SSH into the droplet:

```bash
ssh root@DROPLET_PUBLIC_IP
```
Install Docker, Compose, Git, and MySQL client tools:

```bash
apt update
apt install -y ca-certificates curl gnupg git mysql-client
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

### Server Basics & Navigation

Common commands you will use on the droplet:

```bash
# List files in the current directory
ls -la

# Change directory
cd /opt/wards/app

# View file contents
cat WARDS/backend/.env

# Edit a file with nano
nano WARDS/backend/.env

# Check running Docker containers
docker compose ps

# View live logs for a service
docker compose logs -f backend

# Restart a service
docker compose restart backend

# Check disk space
df -h

# Check memory usage
free -h
```

## 3. Clone The Repository

Create a deployment directory:

```bash
mkdir -p /opt/wards
cd /opt/wards
git clone REPO_SSH_OR_HTTPS_URL app
cd app
```

Use `main` for production:

```bash
git checkout main
```

## 4. Create Production Environment

Create the backend `.env` file:

```bash
cp WARDS/backend/.env.example WARDS/backend/.env
nano WARDS/backend/.env
```

Set strong production values. **Never commit real passwords or secrets to Git.** The values shown below are placeholders — replace every `CHANGE_ME_...` or `your-...` string with strong, unique secrets before starting the stack.

```env
APP_ENV=production
DEBUG=false
HTTPS_ONLY=false
CORS_ORIGINS=http://DROPLET_PUBLIC_IP:3000
FRONTEND_BASE_URL=http://DROPLET_PUBLIC_IP:3000
BACKEND_BASE_URL=http://DROPLET_PUBLIC_IP:8000
DATABASE_URL=mysql+pymysql://root:CHANGE_ME_STRONG_MYSQL_ROOT_PASSWORD@mysql:3306/wards_db
REDIS_URL=redis://redis:6379/0
ADMIN_SECRET_KEY=long-random-admin-secret
USER_SECRET_KEY=long-random-user-secret
BRANCH_SECRET_KEY=long-random-branch-secret
PASSWORD_RESET_SECRET_KEY=long-random-reset-secret
DATA_ENCRYPTION_SECRET=long-random-data-encryption-secret
DATA_HASH_SECRET=long-random-data-hash-secret
LOG_INTEGRITY_SECRET=long-random-log-integrity-secret
BACKUP_INTEGRITY_SECRET=long-random-backup-integrity-secret
INTERNAL_API_SECRET=long-random-internal-api-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME_STRONG_ADMIN_PASSWORD
ADMIN_EMAIL=admin@your-domain.local
SUPERADMIN_USERNAME=superadmin
SUPERADMIN_PASSWORD=CHANGE_ME_STRONG_SUPERADMIN_PASSWORD
SUPERADMIN_EMAIL=superadmin@your-domain.local
RECAPTCHA_SECRET_KEY=your-recaptcha-secret
PAYMONGO_WEBHOOK_SECRET=your-paymongo-webhook-secret
```

Create the root compose `.env`:

```bash
nano .env
```

Add:

```env
MYSQL_ROOT_PASSWORD=CHANGE_ME_STRONG_MYSQL_ROOT_PASSWORD
MYSQL_DATABASE=wards_db
VITE_API_BASE_URL=http://DROPLET_PUBLIC_IP:8000/api
VITE_RECAPTCHA_SITE_KEY=your-recaptcha-site-key
```

Keep `HTTPS_ONLY=false` until you have a domain and TLS reverse proxy. After adding a domain and certificate, set URLs to `https://...`, update `CORS_ORIGINS`, and set `HTTPS_ONLY=true`.

## 5. Start The Stack

Build and run:

```bash
docker compose up -d --build
docker compose ps
```

Check health:

```bash
curl http://DROPLET_PUBLIC_IP:8000/api/health
curl http://DROPLET_PUBLIC_IP:3000/
```

View logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql
docker compose logs -f redis
```

## 6. Database Setup

The backend creates/updates tables at startup through the existing SQLAlchemy startup logic. After the first boot:

```bash
docker compose logs backend | tail -n 100
```

If you need to inspect MySQL:

```bash
docker compose exec mysql mysql -uroot -p wards_db
```

Run seed scripts only when you intentionally need demo/bootstrap data:

```bash
docker compose exec backend python seed_data.py
docker compose exec backend python auth/seed_auth_users.py
```

Before production use, change all default or generated passwords and confirm admin MFA setup.

## 7. Backups And Restore

Create a manual backup:

```bash
docker compose exec backend python - <<'PY'
from utils.backup_engine import create_database_backup
print(create_database_backup())
PY
```

Backups are controlled by `BACKUP_DIR` in `WARDS/backend/.env`. Keep the directory outside public web roots and copy backups off the droplet regularly.

Test restore on a staging droplet before trusting production restore:

```bash
docker compose exec backend python - <<'PY'
from utils.backup_engine import restore_database_backup
restore_database_backup("/path/to/backup.sql.gz")
PY
```

## 8. Wazuh Agent Setup

Install the Wazuh agent on the droplet:

```bash
curl -sO https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.5-1_amd64.deb
WAZUH_MANAGER='WAZUH_MANAGER_IP_OR_HOSTNAME' dpkg -i ./wazuh-agent_4.7.5-1_amd64.deb
systemctl daemon-reload
systemctl enable wazuh-agent
systemctl start wazuh-agent
```

Add WARDS monitored paths in the Wazuh agent config:

```bash
nano /var/ossec/etc/ossec.conf
```

Include file integrity monitoring for:

```xml
<!-- On VM 1 -->
<directories check_all="yes" realtime="yes">/opt/wards/app/WARDS</directories>
<directories check_all="yes" realtime="yes">/opt/wards/app/OCR</directories>

<!-- On VM 2 (Security Server) -->
<directories check_all="yes" realtime="yes">/opt/wards/security/app/SECURITY</directories>
<directories check_all="yes" realtime="yes">/opt/wards/security/app/QUARANTINE</directories>
```

Restart:

```bash
systemctl restart wazuh-agent
```

Confirm the agent appears in the Wazuh manager. Keep `SECURITY/wazuh/local_rules.xml` synced with the manager rules if you use the WARDS custom rules.

## 9. Manual Deployment On The Droplet

If the GitHub Actions workflow is not available (e.g., CI secrets are not configured), you can deploy manually from the droplet.

### Update Code From The Repository

```bash
cd /opt/wards/app
git status
git stash          # optional: stash any local changes
git pull origin main
```

### Rebuild And Restart

```bash
cd /opt/wards/app
docker compose down
docker compose up -d --build
docker compose ps
```

### View Logs After Manual Deploy

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## 10. Configure Continuous Delivery (Webhook Deployer)

WARDS uses a **webhook deployer** on VM 1 instead of SSH-based CI deployment. When you push to `main`, GitHub sends a webhook payload to VM 1, which then pulls code and rebuilds both VM 1 and VM 2 automatically.

### 10.1 Install the Webhook Deployer on VM 1

```bash
ssh root@DROPLET_PUBLIC_IP

cd /opt/wards/app
pip install -r scripts/requirements-webhook.txt

# Create the systemd service file
cp scripts/webhook-deploy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now webhook-deploy
```

The service file sets these environment variables:

```text
WEBHOOK_SECRET=your-github-webhook-secret
DEPLOY_DIR=/opt/wards/app
VM2_API_URL=http://VM2_IP:8443
VM2_APP_DIR=/opt/wards/security/app
API_KEY=shared-api-key-between-vms
```

> **Generate a strong webhook secret:** `openssl rand -hex 32`

### 10.2 Configure the GitHub Webhook

1. In your GitHub repo, go to **Settings → Webhooks → Add webhook**.
2. **Payload URL:** `http://DROPLET_PUBLIC_IP:9000/webhook`
3. **Content type:** `application/json`
4. **Secret:** the same value as `WEBHOOK_SECRET` above
5. **Events:** Push
6. Click **Add webhook**.

### 10.3 How It Works

On every push to `main`:

1. GitHub sends a signed payload to `http://VM1_IP:9000/webhook`.
2. The deployer verifies the signature, then:
   - Pulls `main` and rebuilds VM 1 (`docker compose up -d --build`).
   - Sends an HTTP POST to VM 2's `/internal/deploy` endpoint to trigger VM 2's auto-deploy.
3. The CI workflow polls `/deploy-status` (VM 1) and `/vm2-deploy-status` (VM 2 via VM 1 proxy) to verify both VMs are on the same commit.

### 10.4 Verify Deployment Sync

After a push, check both VMs from your local machine:

```bash
curl http://DROPLET_PUBLIC_IP:9000/deploy-status
curl http://DROPLET_PUBLIC_IP:9000/vm2-deploy-status
```

Both should show the same commit hash. The CI workflow in `.github/workflows/wards-ci.yml` does this automatically in the `deploy-status` job.

## 11. Team Git Workflow

Use branches for all work:

```bash
git checkout main
git pull origin main
git checkout -b feature/short-description
```

Before pushing:

```bash
git status
python -m pytest tests -q
cd WARDS/frontend && npm run build
```

Commit and push:

```bash
git add FILES_YOU_CHANGED
git commit -m "Clear, specific message"
git push origin feature/short-description
```

Open a pull request into `main`. Do not push directly to `main` unless your group explicitly agrees it is an emergency fix. After merging:

```bash
git checkout main
git pull origin main
```

If two members edit the same file, pull first and resolve conflicts locally. Never force-push shared branches unless everyone working on that branch agrees.

### Pulling Changes On The Droplet

When a teammate merges to `main`, update the droplet:

```bash
cd /opt/wards/app
git pull origin main
```

Then rebuild services:

```bash
docker compose up -d --build
```

## 12. Post-Deployment Checklist

- Confirm `docker compose ps` on VM 1 shows all services healthy/running.
- Confirm `docker compose -f docker-compose.security.yml ps` on VM 2 shows `security-db` and `security-api` healthy.
- Confirm frontend loads at `http://DROPLET_PUBLIC_IP:3000`.
- Confirm backend health at `http://DROPLET_PUBLIC_IP:8000/api/health`.
- Confirm login works for superadmin, branch admin, branch staff, and citizen users.
- Confirm citizen registration email verification works.
- Confirm queue, payment, memo, backup, and security dashboard workflows.
- Confirm security dashboard File Status, Detection History, and Security Incidents tabs load data from VM 2.
- Confirm Redis is used for production rate limiting.
- Confirm database backup creates a real `.sql.gz`.
- Confirm Wazuh agent is connected on both VMs.
- Confirm DigitalOcean firewall does not expose MySQL or Redis.
- Confirm webhook deployer is running (`systemctl status webhook-deploy`) and GitHub webhooks deliver successfully.
- Confirm `/deploy-status` and `/vm2-deploy-status` return matching commits after a push.
- Review `docker compose logs backend` on VM 1 for startup errors or missing env vars.

