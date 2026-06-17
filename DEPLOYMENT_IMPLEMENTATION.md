# WARDS DigitalOcean Deployment Implementation

This guide deploys WARDS on a DigitalOcean Ubuntu droplet using Docker Compose, MySQL, Redis, the FastAPI backend, the built React frontend, and optional Wazuh agent monitoring.

## 1. Prepare DigitalOcean

1. Create an Ubuntu 22.04 or 24.04 droplet.
2. Recommended minimum size: 2 vCPU, 4 GB RAM, 80 GB disk.
3. Add your SSH key during droplet creation.
4. In the DigitalOcean firewall, allow:
   - SSH: `22` from your team IPs only. You can find your IP by visiting https://api.ipify.org + /32
   - Frontend: `3000` from all IPv4/IPv6 while you do not have a domain.
   - Backend API: `8000` from all IPv4/IPv6 while you do not have a domain.
   - MySQL and Redis: do not expose publicly.

Without a domain, your temporary URLs are:

```text
Frontend: http://DROPLET_PUBLIC_IP:3000
Backend API: http://DROPLET_PUBLIC_IP:8000
Health check: http://DROPLET_PUBLIC_IP:8000/api/health
```

## 2. Install Server Packages

SSH into the droplet:

```bash
ssh root@DROPLET_PUBLIC_IP
```
152.42.249.84
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

Set strong production values:

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
<directories check_all="yes" realtime="yes">/opt/wards/app/WARDS</directories>
<directories check_all="yes" realtime="yes">/opt/wards/app/OCR</directories>
<directories check_all="yes" realtime="yes">/opt/wards/app/SECURITY</directories>
```

Restart:

```bash
systemctl restart wazuh-agent
```

Confirm the agent appears in the Wazuh manager. Keep `SECURITY/wazuh/local_rules.xml` synced with the manager rules if you use the WARDS custom rules.

## 9. Configure Continuous Delivery

In GitHub, add repository variable:

```text
ENABLE_DIGITALOCEAN_DEPLOY=true
```

Add repository secrets:

```text
DO_HOST=DROPLET_PUBLIC_IP
DO_USER=root
DO_APP_DIR=/opt/wards/app
DO_SSH_KEY=private SSH key allowed to access the droplet
```

The workflow `.github/workflows/wards-ci.yml` now runs:

1. Repository hygiene checks.
2. Backend compile and pytest.
3. Focused auth workflow tests.
4. Frontend `npm ci` and production build.
5. Deployment to DigitalOcean only after all CI jobs pass on `main`.

## 10. Team Git Workflow

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

## 11. Post-Deployment Checklist

- Confirm `docker compose ps` shows all services healthy/running.
- Confirm frontend loads at `http://DROPLET_PUBLIC_IP:3000`.
- Confirm backend health at `http://DROPLET_PUBLIC_IP:8000/api/health`.
- Confirm login works for superadmin, branch admin, branch staff, and citizen users.
- Confirm citizen registration email verification works.
- Confirm queue, payment, memo, backup, and security dashboard workflows.
- Confirm Redis is used for production rate limiting.
- Confirm database backup creates a real `.sql.gz`.
- Confirm Wazuh agent is connected.
- Confirm DigitalOcean firewall does not expose MySQL or Redis.
- Review `docker compose logs backend` for startup errors or missing env vars.

