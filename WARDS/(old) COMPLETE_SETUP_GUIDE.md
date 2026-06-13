# WARDS Complete Setup Guide (Fresh Install)

This is the complete setup guide for running WARDS on a fresh Windows PC using **MySQL Workbench**.

---

## Prerequisites

Install the following software before proceeding:

| Software | Version | Download Link |
|----------|---------|---------------|
| **Python** | 3.10 or 3.11 | https://www.python.org/downloads/ |
| **Node.js** | 18+ (LTS recommended) | https://nodejs.org/ |
| **MySQL Workbench** | 8.0+ | https://dev.mysql.com/downloads/workbench/ |
| **MySQL Server** | 8.0+ | https://dev.mysql.com/downloads/mysql/ |
| **Git** | Latest | https://git-scm.com/downloads |

### Verify Installations

Open PowerShell and run:

```powershell
python --version
node --version
npm --version
mysql --version
```

---

## Step 1: MySQL Database Setup

### 1.1 Open MySQL Workbench

1. Launch **MySQL Workbench**
2. Connect to your local MySQL instance (usually `localhost:3306`)
3. Enter your MySQL root password when prompted

### 1.2 Create the Database

In MySQL Workbench, run this SQL query:

```sql
CREATE DATABASE IF NOT EXISTS wards_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 1.3 Import the Database Schema (Optional)

If you have the `wards_db.sql` file:

1. In MySQL Workbench: **Server** → **Data Import**
2. Select **Import from Self-Contained File**
3. Browse to: `WARDS_MASTERFILE\wards_db.sql`
4. Select target schema: `wards_db`
5. Click **Start Import**

**OR** via command line:

```powershell
mysql -u root -p wards_db < "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\wards_db.sql"
```

---

## Step 2: Backend Setup

### 2.1 Navigate to Backend Directory

```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
```

### 2.2 Create Python Virtual Environment

```powershell
python -m venv venv
```

### 2.3 Activate Virtual Environment

```powershell
.\venv\Scripts\activate
```

You should see `(venv)` at the start of your command prompt.

### 2.4 Install Python Dependencies

```powershell
pip install -r requirements.txt
```

### 2.5 Configure Backend Environment

Create or edit the `.env` file in the `backend` folder with the following content:

```env
# ============================================
# SECURITY KEYS (Change these in production!)
# ============================================
SECRET_KEY=your-secret-key-here-change-in-production
ADMIN_SECRET_KEY=your-admin-secret-key-change-in-production-immediately

# ============================================
# DATABASE CONNECTION (MySQL)
# ============================================
# Format:  
# Note: Special characters in password must be URL-encoded
# Example: @ becomes %40, # becomes %23
DATABASE_URL=mysql+pymysql://root:YOUR_PASSWORD_HERE@localhost:3306/wards_db

# ============================================
# SERVER CONFIGURATION
# ============================================
API_PORT=8000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000

# ============================================
# ADMIN BOOTSTRAP CREDENTIALS
# ============================================
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password-immediately
ADMIN_EMAIL=treasurermain@gmail.com

# ============================================
# SECURITY SETTINGS
# ============================================
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=60

# ============================================
# EMAIL CONFIGURATION (Gmail SMTP)
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_gmail_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_FROM_NAME=WARDS Admin
SMTP_USE_TLS=true

# ============================================
# EMAIL VERIFICATION (Optional)
# ============================================
QUICKEMAILVERIFICATION_API_KEY=your_quickemailverification_api_key
QUICKEMAILVERIFICATION_TIMEOUT_SECONDS=8

# ============================================
# PAYMONGO PAYMENT INTEGRATION
# ============================================
PAYMONGO_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
PAYMONGO_PUBLIC_KEY=pk_test_YOUR_PUBLIC_KEY_HERE

# ============================================
# OCR CONFIGURATION (Optional)
# ============================================
# LLMWHISPERER_API_KEY=your_llmwhisperer_key
# OCR_PROJECT_DIR=C:\path\to\OCR\project
```

### 2.6 Important: URL-Encode Special Characters in MySQL Password

If your MySQL password contains special characters, encode them:

| Character | Encoded |
|-----------|---------|
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `/` | `%2F` |
| `=` | `%3D` |
| `?` | `%3F` |

**Example:** Password `Teten@5555` becomes `Teten%405555`

```env
DATABASE_URL=mysql+pymysql://root:Teten%405555@localhost:3306/wards_db
```

---

## Step 3: Frontend Setup

### 3.1 Open a New PowerShell Window

```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\frontend"
```

### 3.2 Install Node.js Dependencies

```powershell
npm install
```

### 3.3 Fix Security Vulnerabilities (Optional but Recommended)

```powershell
npm audit fix
```

---

## Step 4: PayMongo Payment Setup

### 4.1 Get PayMongo API Keys

1. Go to https://dashboard.paymongo.com/
2. Sign up or log in
3. Navigate to **Developers** → **API Keys**
4. Copy your keys:
   - **Secret Key** (starts with `sk_test_` for test mode)
   - **Public Key** (starts with `pk_test_` for test mode)

### 4.2 Add Keys to Backend `.env`

```env
PAYMONGO_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
PAYMONGO_PUBLIC_KEY=pk_test_YOUR_PUBLIC_KEY_HERE
```

### 4.3 Run PayMongo Migration

```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
.\venv\Scripts\activate
python migrations/add_paymongo_fields.py
```

Type `yes` when prompted.

---

## Step 5: Gmail SMTP Setup (For Email Features)

### 5.1 Enable 2-Factor Authentication

1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification**

### 5.2 Generate App Password

1. Go to https://myaccount.google.com/apppasswords
2. Select **Mail** and **Windows Computer**
3. Click **Generate**
4. Copy the 16-character password (no spaces)

### 5.3 Update Backend `.env`

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_16_char_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_FROM_NAME=WARDS Admin
SMTP_USE_TLS=true
```

---

## Step 6: Running the Application

### 6.1 Start Backend (Terminal 1)

```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
.\venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**OR** using the main.py directly:

```powershell
python main.py
```

### 6.2 Start Frontend (Terminal 2)

```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\frontend"
npm run dev
```

### 6.3 Access the Application

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8000 |
| **API Documentation** | http://localhost:8000/docs |

---

## Default Credentials

### Main Admin

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `change-this-password-immediately` |
| Email | `treasurermain@gmail.com` |

### Test Branch Credentials (if seeded)

| Role | Username | Password |
|------|----------|----------|
| Branch Admin | `galas_admin` | `galas123` |
| Branch Staff | - | `branch123` |

---

## Test Data for Payment Testing

Use these test values when testing the system:

### Test Set 1
- **TDN:** `TDN-QC-2026-000145`
- **Mayor's Permit Number:** `MP-QC-2026-01872`
- **SEC/DTI/CDA Registration Number:** `DTI-NCR-2026-091245`

### Test Set 2
- **TDN:** `TDN-GALAS-2026-000201`
- **Mayor's Permit Number:** `MP-GALAS-2026-00441`
- **SEC/DTI/CDA Registration Number:** `DTI-QUEZON-2026-114208`

### Test Set 3
- **TDN:** `TDN-NOVA-2026-000332`
- **Mayor's Permit Number:** `MP-NOVA-2026-00719`
- **SEC/DTI/CDA Registration Number:** `DTI-NCR-2026-223514`

### PayMongo Test Card

| Field | Value |
|-------|-------|
| Card Number | `4343434343434345` |
| Expiry | Any future date (e.g., `12/28`) |
| CVV | Any 3 digits (e.g., `123`) |
| Name | Any name |

---

## Quick Reference Commands

### Daily Startup (After Initial Setup)

**Terminal 1 - Backend:**
```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
.\venv\Scripts\activate
uvicorn main:app --reload
```

**Terminal 2 - Frontend:**
```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\frontend"
npm run dev
```

### Build Check

**Frontend:**
```powershell
cd "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\frontend"
npm run build
```

**Backend Syntax:**
```powershell
python -m py_compile "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py"
```

---

## Troubleshooting

### MySQL Connection Failed

1. Verify MySQL Server is running
2. Check credentials in `.env`
3. Ensure password special characters are URL-encoded
4. Test connection in MySQL Workbench first

### Backend Won't Start

1. Ensure virtual environment is activated (`(venv)` visible)
2. Check all dependencies installed: `pip install -r requirements.txt`
3. Verify `.env` file exists and is properly configured

### Frontend Won't Start

1. Ensure `npm install` completed successfully
2. Check for port conflicts on 3000
3. Run `npm audit fix` if there are vulnerabilities

### Email Not Sending

1. Verify Gmail App Password (not regular password)
2. Check 2FA is enabled on Gmail account
3. Verify SMTP settings in `.env`

### New Features Not Appearing

1. Restart the backend server
2. Hard refresh browser: `Ctrl + Shift + R`

### Payment Not Working

1. Verify PayMongo API keys in `.env`
2. Check if using test keys (`sk_test_`, `pk_test_`)
3. Run PayMongo migration script
4. Check backend logs: `backend/api.err.log`

---

## Project Structure

```
WARDS/
├── backend/
│   ├── main.py              # Main FastAPI application
│   ├── requirements.txt     # Python dependencies
│   ├── .env                 # Environment configuration
│   ├── database/            # Database models
│   ├── routes/              # API routes
│   ├── services/            # Business logic
│   ├── migrations/          # Database migrations
│   └── uploads/             # Uploaded files
├── frontend/
│   ├── src/                 # React source code
│   ├── package.json         # Node.js dependencies
│   └── vite.config.js       # Vite configuration
└── COMPLETE_SETUP_GUIDE.md  # This file
```

---

## Useful URLs

| Description | URL |
|-------------|-----|
| Home Page | http://localhost:3000/ |
| Login | http://localhost:3000/login |
| Request Receipt | http://localhost:3000/request-receipt |
| Pay Taxes Online | http://localhost:3000/pay-taxes |
| API Documentation | http://localhost:8000/docs |
| PayMongo Dashboard | https://dashboard.paymongo.com/ |

---

## Security Notes

- ✅ Never commit `.env` file to git
- ✅ Change all default passwords before production
- ✅ Use test API keys for development only
- ✅ Use live API keys only in production with HTTPS
- ✅ Keep all API keys secret

---

**Setup Complete! 🎉**

Your WARDS system is now ready for use with MySQL database and PayMongo payment processing.
