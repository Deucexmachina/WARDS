# DEFACEMENT Third-Party Attack Simulator

This folder is intentionally isolated from WARDS. It imports no WARDS modules and can be deleted without breaking WARDS, OCR, SECURITY, or QUARANTINE.

Run it only during local security testing:

```powershell
cd "WARDS MASTERFILE\DEFACEMENT"
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --reload --port 3010
```

Open:

```text
http://localhost:3010
```

Before testing attacks:

1. Start WARDS backend and frontend.
2. Open the Security Dashboard.
3. Create a Manual Backup.
4. For automatic restoration while deployed, set these in `WARDS/backend/.env` and restart backend:

```env
SECURITY_DEPLOYMENT_MODE=deployed
SECURITY_MONITORING_ENABLED=true
SECURITY_SCAN_INTERVAL_SECONDS=30
```

If monitoring is disabled, click Security Dashboard -> Manual Controls -> Verify System Integrity after running an attack.

