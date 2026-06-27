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
import time
import threading

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


def _unpause_vm2() -> bool:
    """Clear VM2 deployment pause with retries. Returns True on success."""
    if not VM2_HOST or not VM2_API_KEY:
        return False
    for attempt in range(5):
        try:
            resp = httpx.post(
                f"https://{VM2_HOST}/internal/deployment-mode",
                headers={"X-API-Key": VM2_API_KEY},
                json={"in_progress": False},
                timeout=10.0,
            )
            resp.raise_for_status()
            logger.info("VM2 deployment mode cleared")
            return True
        except Exception as e:
            logger.warning(
                "Could not clear VM2 deployment mode (attempt %d/5): %s",
                attempt + 1, e,
            )
            if attempt < 4:
                time.sleep(2 ** attempt)
    logger.error(
        "CRITICAL: Failed to clear VM2 deployment mode after 5 attempts. "
        "VM2 will auto-clear the stale pause after 10 minutes."
    )
    return False


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

    target_commit = payload.get("after", "")
    logger.info("Webhook push target commit: %s", target_commit)

    vm2_pushed_pause = False
    deployment_resumed = False  # True only after successful commit verification + unpause

    def _get_vm1_commit() -> str:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=DEPLOY_DIR,
        )
        return result.stdout.strip() if result.returncode == 0 else ""

    def _get_vm2_commit() -> str | None:
        try:
            resp = httpx.get(
                f"https://{VM2_HOST}/internal/deploy-status",
                headers={"X-API-Key": VM2_API_KEY},
                timeout=5.0,
            )
            if resp.status_code == 200:
                return resp.json().get("commit", "")
        except Exception:
            pass
        return None

    try:
        # --- Step 1: Pause VM2 monitoring ---
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

        # --- Step 2: Deploy VM1 ---
        logger.info("Deploying VM1 from %s", DEPLOY_DIR)
        run_cmd(["git", "fetch", "origin", "main"], cwd=DEPLOY_DIR)
        run_cmd(["git", "reset", "--hard", "origin/main"], cwd=DEPLOY_DIR)
        run_cmd(["docker", "compose", "up", "-d", "--build"], cwd=DEPLOY_DIR)

        # --- Step 3: Verify VM1 is on target commit ---
        vm1_commit = _get_vm1_commit()
        if target_commit and vm1_commit != target_commit:
            raise RuntimeError(
                f"VM1 commit verification failed: expected={target_commit}, got={vm1_commit}"
            )
        logger.info("VM1 commit verified: %s", vm1_commit)

        # --- Step 4: Deploy VM2 ---
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
                raise RuntimeError(f"VM2 deploy trigger failed: {e}")

            # --- Step 5: Wait for VM2 to restart ---
            logger.info("Waiting for VM2 to finish startup baseline...")
            vm2_commit = None
            for attempt in range(30):
                time.sleep(2)
                vm2_commit = _get_vm2_commit()
                if vm2_commit and vm2_commit != "unknown":
                    logger.info("VM2 is back up: commit=%s", vm2_commit)
                    break
            else:
                raise RuntimeError("VM2 did not become ready within timeout")

            # --- Step 6: Verify VM2 is on target commit ---
            if target_commit and vm2_commit != target_commit:
                raise RuntimeError(
                    f"VM2 commit verification failed: expected={target_commit}, got={vm2_commit}"
                )
            logger.info("VM2 commit verified: %s", vm2_commit)

            # Give monitor loop time to run startup baseline
            time.sleep(10)

            # --- Step 7: Trigger post-deploy backup ---
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
                # Non-fatal: backup failure should not block unpause

        # --- Step 8: Resume monitoring (success path) ---
        if vm2_pushed_pause:
            if _unpause_vm2():
                deployment_resumed = True

        # --- Step 9: Restart webhook process to load updated code ---
        # The running Python process still has the OLD code in memory.
        # Schedule an execv replacement so the next webhook uses new code.
        logger.info("Scheduling webhook self-restart in 2s to load updated code")
        threading.Thread(target=lambda: (time.sleep(2), os.execv(sys.executable, [sys.executable] + sys.argv)), daemon=True).start()

    except Exception as e:
        logger.exception("Deploy failed")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # Safety net: unpause VM2 if we paused it but never resumed (failure case)
        if vm2_pushed_pause and not deployment_resumed:
            logger.warning("Deploy failed or incomplete — running safety-net unpause")
            _unpause_vm2()

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
