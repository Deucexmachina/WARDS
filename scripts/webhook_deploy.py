"""
GitHub Webhook Deploy Receiver
================================
Run this on VM1 (port 9000) to auto-deploy on push to main.
Verifies GitHub webhook signatures. Supports triggering VM2 rebuild.

Usage:
    export WEBHOOK_SECRET=your_github_webhook_secret
    export DEPLOY_DIR=/opt/wards/app
    export VM2_HOST=146.190.97.87
    export VM2_USER=root
    export VM2_APP_DIR=/opt/wards/security/app
    python webhook_deploy.py

Systemd service:
    Copy webhook-deploy.service to /etc/systemd/system/
    systemctl enable --now webhook-deploy
"""
import os
import sys
import hmac
import hashlib
import json
import subprocess
import logging

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import PlainTextResponse
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("webhook-deploy")

app = FastAPI()

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "").encode()
DEPLOY_DIR = os.environ.get("DEPLOY_DIR", "/opt/wards/app")
VM2_HOST = os.environ.get("VM2_HOST", "")
VM2_USER = os.environ.get("VM2_USER", "root")
VM2_APP_DIR = os.environ.get("VM2_APP_DIR", "/opt/wards/security/app")


def verify_signature(body: bytes, signature: str) -> bool:
    if not WEBHOOK_SECRET:
        logger.error("WEBHOOK_SECRET not set — rejecting all requests")
        return False
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def run_cmd(cmd: list[str], cwd: str | None = None) -> str:
    logger.info("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        logger.error("Command failed: %s", result.stderr)
        raise RuntimeError(result.stderr)
    logger.info("Output: %s", result.stdout.strip())
    return result.stdout.strip()


@app.post("/webhook")
async def github_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")

    if not verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = request.headers.get("X-GitHub-Event", "")
    if event != "push":
        return PlainTextResponse("Ignored non-push event", status_code=200)

    payload = json.loads(body)
    ref = payload.get("ref", "")
    if not ref.endswith("/main"):
        return PlainTextResponse("Ignored non-main branch", status_code=200)

    try:
        # Deploy VM1
        logger.info("Deploying VM1 from %s", DEPLOY_DIR)
        run_cmd(["git", "fetch", "origin", "main"], cwd=DEPLOY_DIR)
        run_cmd(["git", "reset", "--hard", "origin/main"], cwd=DEPLOY_DIR)
        run_cmd(["docker", "compose", "up", "-d", "--build"], cwd=DEPLOY_DIR)

        # Deploy VM2 (via SSH if configured)
        if VM2_HOST:
            logger.info("Deploying VM2 at %s", VM2_HOST)
            ssh_cmd = (
                f"ssh -o StrictHostKeyChecking=no -i ~/.ssh/vm2_deploy_key "
                f"{VM2_USER}@{VM2_HOST} "
                f"'cd {VM2_APP_DIR} && docker compose -f docker-compose.security.yml stop security-api && "
                f"git fetch origin main && git reset --hard origin/main && "
                f"docker compose -f docker-compose.security.yml up -d --build'"
            )
            run_cmd(["bash", "-c", ssh_cmd])

        return PlainTextResponse("Deployed VM1 and VM2", status_code=200)

    except Exception as e:
        logger.exception("Deploy failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    if not WEBHOOK_SECRET:
        logger.warning("WEBHOOK_SECRET is not set. All webhook requests will be rejected.")
    uvicorn.run(app, host="0.0.0.0", port=9000)
