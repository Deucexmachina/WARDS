#!/usr/bin/env bash
# setup_vm2.sh
# Run this on the fresh Security Server (VM 2) to install Docker, clone the repo,
# and prepare the environment for docker-compose.security.yml.

set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DIR="${APP_DIR:-/opt/wards/security}"

if [ -z "$REPO_URL" ]; then
    echo "ERROR: Set REPO_URL to your Git repository SSH or HTTPS URL."
    echo "Example: REPO_URL=git@github.com:your-org/wards.git ./setup_vm2.sh"
    exit 1
fi

echo "=== WARDS Security VM 2 Setup ==="
echo "Repo: $REPO_URL"
echo "Target: $APP_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. Install Docker and Docker Compose
# ---------------------------------------------------------------------------
echo "[1/4] Installing Docker..."
apt-get update
apt-get install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# ---------------------------------------------------------------------------
# 2. Clone repository
# ---------------------------------------------------------------------------
echo "[2/4] Cloning repository into $APP_DIR ..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ ! -d "app/.git" ]; then
    git clone "$REPO_URL" app
fi
cd app
git checkout main
git pull origin main

# ---------------------------------------------------------------------------
# 3. Create environment file
# ---------------------------------------------------------------------------
echo "[3/4] Creating .env for VM 2..."
if [ ! -f ".env" ]; then
    cat > .env <<'EOF'
# Security VM Environment
SEC_MYSQL_ROOT_PASSWORD=CHANGE_ME_STRONG_PASSWORD
APP_API_KEY=CHANGE_ME_LONG_RANDOM_API_KEY
WARDS_APP_IP=CHANGE_ME_VM1_PUBLIC_IP
EOF
    echo ".env created. EDIT IT NOW and set strong values."
else
    echo ".env already exists — not overwriting."
fi

# ---------------------------------------------------------------------------
# 4. Start security stack
# ---------------------------------------------------------------------------
echo "[4/4] Starting security services..."
docker compose -f docker-compose.security.yml up -d --build
docker compose -f docker-compose.security.yml ps

echo ""
echo "=== VM 2 Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit $APP_DIR/app/.env with real passwords and API keys."
echo "  2. Restart: cd $APP_DIR/app && docker compose -f docker-compose.security.yml up -d"
echo "  3. Test health: curl -H 'X-API-Key: YOUR_KEY' http://localhost:8443/health"
