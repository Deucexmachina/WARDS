# WARDS Backend API

Python FastAPI backend for the City Treasurer's Office WARDS system.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create .env file from .env.example:
```bash
cp .env.example .env
```

5. Run the server:
```bash
python main.py
```

The API will be available at http://localhost:8000

## Gmail SMTP For WARDS Emails

WARDS is set up to send email through Gmail SMTP.

This is used for:

- branch access emails
- citizen email OTP verification
- released receipt copy emails

Set these environment variables in your backend `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_gmail_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_FROM_NAME=WARDS Admin
SMTP_USE_TLS=true
FRONTEND_BASE_URL=http://localhost:3000
```

Use a Gmail App Password here, not your normal Gmail password.

## QuickEmailVerification

WARDS can use QuickEmailVerification for stricter email validation before an address is accepted.

Add these to your backend `.env`:

```bash
QUICKEMAILVERIFICATION_API_KEY=your_quickemailverification_api_key
QUICKEMAILVERIFICATION_TIMEOUT_SECONDS=8
```

When configured, WARDS verifies email deliverability and blocks disposable or unsafe email addresses before OTP and account creation continue.

While the project is still local, the email will contain the localhost branch dashboard link:

`http://localhost:3000/branch-dashboard`

## API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Endpoints

### Authentication
- POST /api/auth/login - User login
- POST /api/auth/logout - User logout
- GET /api/auth/me - Get current user

### Payments
- POST /api/payments/generate-reference - Generate payment reference
- POST /api/payments/process - Process payment
- GET /api/payments/verify/{ref_number} - Verify payment
- GET /api/payments/transactions - Get all transactions

### Receipts
- POST /api/receipts/request - Request receipt copy
- GET /api/receipts/request/{request_id} - Get request status
- POST /api/receipts/request/{request_id}/pay - Pay request fee
- POST /api/receipts/upload-proof - Upload proof of payment

### Branches
- GET /api/branches - Get all branches
- POST /api/branches - Create branch
- PUT /api/branches/{id} - Update branch
- DELETE /api/branches/{id} - Delete branch

### Reports
- POST /api/reports/generate - Generate report
- GET /api/reports - Get all reports
- GET /api/reports/{id}/export/{format} - Export report

### Other Modules
- Announcements: /api/announcements
- Memos: /api/memos
- Alerts: /api/alerts
- Activity Logs: /api/activity-logs
- Backup: /api/backup
- Accounts: /api/accounts
