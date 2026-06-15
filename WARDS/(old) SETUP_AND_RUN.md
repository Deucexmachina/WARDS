# WARDS Setup And Run Guide

This guide is for running WARDS locally on Windows.

## Project Structure

- `backend/` - FastAPI API, auth, branch logic, receipt flow, OCR wiring
- `frontend/` - React + Vite frontend
- `backend/wards.db` - main SQLite database used by the backend

## Requirements

Install these first:

- Python 3.11
- Node.js 18+ recommended
- npm

Optional but used by this project:

- Google reCAPTCHA keys
- Gmail SMTP account for branch access emails, citizen verification emails, and released receipt copies
- LLMWhisperer API key for OCR
- Local OCR project folder if you are reusing the separate OCR codebase

## Backend Setup

Open PowerShell in:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
```

Create a virtual environment:

```powershell
python -m venv venv
```

Activate it:

```powershell
```
.\venv\Scripts\activate

Install dependencies:

```powershell
pip install -r requirements.txt
```

## Backend Environment

Create `backend/.env` from `backend/.env.example`.

Minimum recommended keys:

```env
SECRET_KEY=change-me
USER_SECRET_KEY=change-me
BRANCH_SECRET_KEY=change-me
ADMIN_SECRET_KEY=change-me

DATABASE_URL=sqlite:///./wards.db
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
API_PORT=8000

ADMIN_USERNAME=admin
ADMIN_PASSWORD=
ADMIN_EMAIL=admin@example.com
```

### Gmail SMTP

Needed for:

- branch access emails
- citizen OTP verification emails
- released receipt copy emails

### QuickEmailVerification

WARDS can also verify whether an email address is real and safe to use before accepting it into the system.

This adds a stronger layer before OTP:

- checks if the email is deliverable
- blocks disposable or unsafe email addresses
- can catch typo suggestions like `gmial.com` to `gmail.com`

Add these to `backend/.env`:

```env
QUICKEMAILVERIFICATION_API_KEY=your_quickemailverification_api_key
QUICKEMAILVERIFICATION_TIMEOUT_SECONDS=8
```

When this API key is present, WARDS uses QuickEmailVerification as part of standard backend email validation for account creation and public email-entry flows.

This project is configured to use Gmail SMTP.

Use your Gmail address for both `SMTP_USERNAME` and `SMTP_FROM_EMAIL`, and use a Gmail App Password for `SMTP_PASSWORD`.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_FROM_NAME=WARDS Admin
SMTP_USE_TLS=true
FRONTEND_BASE_URL=http://localhost:3000
```

Important:

- Use a Gmail App Password, not your normal Gmail password
- If email sending works in your project, you do not need Brevo
- Keep the same Gmail address in `SMTP_USERNAME` and `SMTP_FROM_EMAIL`

### OCR / LLMWhisperer

Needed if you want the branch receipt OCR flow to work.

```env
LLMWHISPERER_API_KEY=your_llmwhisperer_key
OCR_PROJECT_DIR=C:\Users\Justin Cortez\Desktop\OCR
```

`OCR_PROJECT_DIR` should point to the OCR project root if that separate OCR folder is being reused.

## Run Backend

From `backend/`:

```powershell
.\venv\Scripts\activate
python main.py
```

Backend runs at:

- `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`

## Frontend Setup

Open another PowerShell window:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
```

Install dependencies:

```powershell
npm install
```

Run the frontend:

```powershell
npm run dev
```

Frontend runs at:

- `http://localhost:3000`

## Exact Commands To Run

Yes, for first-time setup the user needs to install the backend requirements and frontend packages first.

### First-time backend setup

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### First-time frontend setup

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm install
```

### Every time you want to run the system

Terminal 1 for backend:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
.\venv\Scripts\activate
python main.py
```

Terminal 2 for frontend:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run dev
```

Then open:

```text
http://localhost:3000
```

### Do I need to reinstall every time?

No.

You only need these once unless something changes:

- `pip install -r requirements.txt`
- `npm install`

After that, normal startup is just:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
.\venv\Scripts\activate
python main.py
```

and in another terminal:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run dev
```

## Normal Local Startup

Start backend first:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\backend
.\venv\Scripts\activate
python main.py
```

Then start frontend:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run dev
```

## Important Local Notes

### 1. Backend restart after schema changes

The backend auto-adds some SQLite columns on startup.

If we add a new DB-backed feature, restart the backend once so the schema update can run.

### 2. Shared branch features

New branches do not get a separate codebase.

They use the same shared branch portal features under their own generated route, for example:

```text
http://localhost:3000/branch-dashboard/galas
```

### 3. Unified login

Main login route:

```text
http://localhost:3000/login
```

Portal-specific routes may still redirect into the unified login flow depending on the screen.

### 4. Receipt request flow

Current public receipt request flow:

1. User fills request form
2. User selects:
   - tax type
   - request type (`Immediate` or `Appointment`)
   - branch
3. User pays request fee
4. Branch handles request

Current branch behavior:

- `Immediate`:
  - appears in the immediate table
  - branch uploads receipt copy
  - branch clicks `Release Copy`
  - finished copy is emailed to requester

- `Appointment`:
  - appears in the appointment table
  - no release-copy email flow
  - branch clicks `Complete`
  - request is removed automatically

### 5. Payment Management in branch portal

Branch `Payment Management` is currently a placeholder screen.

It is not the finalized branch payment workflow yet.

## Useful Test URLs

Frontend:

- Home: `http://localhost:3000/`
- Unified login: `http://localhost:3000/login`
- Public receipt request: `http://localhost:3000/request-receipt`

Backend:

- API root: `http://localhost:8000/`
- Docs: `http://localhost:8000/docs`

## Build Check

Frontend production build:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS\frontend
npm run build
```

Backend syntax check:

```powershell
cd C:\Users\Justin Cortez\Desktop\WARDS
python -m py_compile backend\main.py
```

## Common Problems

### Frontend opens old behavior

Do a hard refresh in the browser after frontend changes.

### New DB-backed feature not showing

Restart the backend so SQLite auto-extension logic runs again.

### Branch email not sending

Check:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`

For Gmail, make sure you are using an app password.

### OCR not working

Check:

- `LLMWHISPERER_API_KEY`
- `OCR_PROJECT_DIR`
- OCR project files exist in that path

## Recommended Workflow

When working locally:

1. Start backend
2. Start frontend
3. Test in browser
4. If a DB-backed feature changes, restart backend
5. If frontend looks stale, hard refresh
