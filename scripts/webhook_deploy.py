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

    vm2_pushed_pause = False
    try:
        # Pause VM2 monitoring before any file changes
        if VM2_HOST and VM2_API_KEY:
            try:
                httpx.post(
                    f"https://{VM2_HOST}/internal/deployment-mode",
                    headers={"X-API-Key": VM2_API_KEY},
                    json={"in_progress": True},
                    timeout=10.0,
                )
                logger.info("VM2 deployment mode enabled")
                vm2_pushed_pause = True
            except Exception as e:
                logger.warning("Could not pause VM2 monitoring before deploy: %s", e)

        # Deploy VM1
        logger.info("Deploying VM1 from %s", DEPLOY_DIR)
        run_cmd(["git", "fetch", "origin", "main"], cwd=DEPLOY_DIR)
        run_cmd(["git", "reset", "--hard", "origin/main"], cwd=DEPLOY_DIR)
        run_cmd(["docker", "compose", "up", "-d", "--build"], cwd=DEPLOY_DIR)

        # Deploy VM2 via authenticated HTTPS trigger (best effort)
        if VM2_HOST and VM2_API_KEY:
            logger.info("Triggering VM2 deploy at %s", VM2_HOST)
            try:
                resp = httpx.post(
                    f"https://{VM2_HOST}/internal/deploy",
                    headers={"X-API-Key": VM2_API_KEY},
                    timeout=30.0,
                )
                resp.raise_for_status()
                logger.info("VM2 deploy triggered: %s", resp.json())
            except Exception as e:
                logger.error("VM2 deploy trigger failed: %s", e)
                # Do not raise — let the finally block unpause so monitoring resumes

            # Wait for VM2 to come back up and finish its startup baseline
            logger.info("Waiting for VM2 to finish startup baseline...")
            import time
            for attempt in range(30):
                time.sleep(2)
                try:
                    status_resp = httpx.get(
                        f"https://{VM2_HOST}/internal/deploy-status",
                        headers={"X-API-Key": VM2_API_KEY},
                        timeout=5.0,
                    )
                    if status_resp.status_code == 200:
                        logger.info("VM2 is back up: %s", status_resp.json())
                        break
                except Exception:
                    pass
            else:
                logger.warning("VM2 did not become ready within timeout; proceeding anyway")

            # Give the monitor loop time to run its startup baseline backup
            time.sleep(10)

            # Trigger post-deploy backup on VM2 so new files have a trusted baseline
            try:
                backup_resp = httpx.post(
                    f"https://{VM2_HOST}/v1/backup/full",
                    headers={"X-API-Key": VM2_API_KEY},
                    timeout=120.0,
                )
                backup_resp.raise_for_status()
                logger.info("VM2 post-deploy backup triggered: %s", backup_resp.json())
            except Exception as e:
                logger.error("VM2 post-deploy backup trigger failed: %s", e)

    except Exception as e:
        logger.exception("Deploy failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # ALWAYS unpause VM2 if we successfully paused it, regardless of deploy success/failure
        if vm2_pushed_pause:
            try:
                httpx.post(
                    f"https://{VM2_HOST}/internal/deployment-mode",
                    headers={"X-API-Key": VM2_API_KEY},
                    json={"in_progress": False},
                    timeout=10.0,
                )
                logger.info("VM2 deployment mode cleared")
            except Exception as e:
                logger.warning("Could not clear VM2 deployment mode: %s", e)

    return PlainTextResponse("Deployed VM1 and VM2", status_code=200)


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/deploy-status")
async def deploy_status():
    import subprocess
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, cwd=DEPLOY_DIR,
    )
    commit = result.stdout.strip() if result.returncode == 0 else "unknown"
    return {"vm": "vm1", "commit": commit, "deploy_dir": DEPLOY_DIR}


@app.get("/vm2-deploy-status")
async def vm2_deploy_status():
    if not VM2_HOST or not VM2_API_KEY:
        raise HTTPException(status_code=503, detail="VM2 not configured")
    try:
        resp = httpx.get(
            f"https://{VM2_HOST}/internal/deploy-status",
            headers={"X-API-Key": VM2_API_KEY},
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error("Failed to fetch VM2 status: %s", e)
        raise HTTPException(status_code=502, detail=f"VM2 status unavailable: {e}")


if __name__ == "__main__":
    if not WEBHOOK_SECRET:
        logger.warning("WEBHOOK_SECRET is not set. All webhook requests will be rejected.")
    uvicorn.run(app, host="0.0.0.0", port=9000)
