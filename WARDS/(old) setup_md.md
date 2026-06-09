# WARDS Quick Setup

This is the short handoff setup file for running WARDS locally.

## Requirements sigma

- Python 3.10 or 3.11
- Node.js 18+
- npm
- MySQL running locally
- Database created: `wards_db`

## Backend `.env`

Current backend database connection in this workspace:

```env
DATABASE_URL=mysql+pymysql://root:Teten%405555@localhost:3306/wards_db
API_PORT=8000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000
```

Current admin bootstrap values in this workspace:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password-immediately
ADMIN_EMAIL=admin@wards.local
```

## First-Time Setup

### Backend

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm install
```

## Run The Project

### Terminal 1 - Backend

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
.\venv\Scripts\activate
uvicorn main:app --reload
```

### Terminal 2 - Frontend

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run dev
```

## Open In Browser

```text
http://localhost:3000
```

## Known / Repo Default Credentials

Use these as reference credentials from the repo and current workspace.

### Main Admin

- Username: `admin`
- Password: `change-this-password-immediately`
- Email: `admin@wards.local`

### Seed / Legacy Repo Credentials

These appear in the repo seed files, but may depend on the current database contents:

- Main admin seed:
  - Username: `admin`
  - Password: `admin123`
- Branch admin seed:
  - Username: `galas_admin`
  - Password: `galas123`
- Alternate branch/admin seed values found in auth seed scripts:
  - Email: `branchadmin@wards.local`
  - Password: `branchadmin123`
  - Branch staff seed password: `branch123`

## Important Notes

- Backend uses MySQL in this workspace, not SQLite.
- If new database-backed features do not appear, restart the backend once.
- If the frontend looks stale, hard refresh the browser with `Ctrl+Shift+R`.
- Public portal runs on `http://localhost:3000`
- Backend Swagger docs run on `http://localhost:8000/docs`

## Quick Build Check

### Frontend

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run build
```

### Backend Syntax Check

```powershell
py -3.10 -m py_compile C:\Users\Justin Cortez\Desktop\WARDS\backend\main.py
```
### IMPORTANT STUFF
TDN: TDN-QC-2026-000145
Mayor's Permit Number: MP-QC-2026-01872
SEC/DTI/CDA Registration Number: DTI-NCR-2026-091245
If you want more test sets, here are extra ones:

TDN: TDN-GALAS-2026-000201

Mayor's Permit Number: MP-GALAS-2026-00441

SEC/DTI/CDA Registration Number: DTI-QUEZON-2026-114208

TDN: TDN-NOVA-2026-000332

Mayor's Permit Number: MP-NOVA-2026-00719

SEC/DTI/CDA Registration Number: DTI-NCR-2026-223514
