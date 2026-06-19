"""
GitHub Webhook Deploy Receiver
================================
Run this on VM1 (port 9000) to auto-deploy on push to main.
Verifies GitHub webhook signatures. Triggers VM2 rebuild via HTTP API.

Usage:
    export WEBHOOK_SECRET=your_github_webhook_secret
    export DEPLOY_DIR=/opt/wards/app
    export VM2_HOST=146.190.97.87
    export VM2_API_KEY=shared_api_key
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

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import PlainTextResponse
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("webhook-deploy")

app = FastAPI()

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "").encode()
DEPLOY_DIR = os.environ.get("DEPLOY_DIR", "/opt/wards/app")
VM2_HOST = os.environ.get("VM2_HOST", "")
VM2_API_KEY = os.environ.get("VM2_API_KEY", "")


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

        # Deploy VM2 via authenticated HTTP trigger
        if VM2_HOST and VM2_API_KEY:
            logger.info("Triggering VM2 deploy at %s", VM2_HOST)
            try:
                resp = httpx.post(
                    f"http://{VM2_HOST}:8443/internal/deploy",
                    headers={"X-API-Key": VM2_API_KEY},
                    timeout=30.0,
                )
                resp.raise_for_status()
                logger.info("VM2 deploy triggered: %s", resp.json())
            except Exception as e:
                logger.error("VM2 deploy trigger failed: %s", e)

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
