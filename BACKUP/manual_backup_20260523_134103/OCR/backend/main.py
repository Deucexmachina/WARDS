from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from database.config import Base, engine, SessionLocal
from database import models  # noqa: F401
from database.security_migrations import (
    apply_phase2_plaintext_redaction,
    backfill_security_hashes,
    ensure_security_columns,
)
from routes import (
    announcements,
    services,
    queue,
    auth_simple,
    admin_simple,
    receipts,
    taxpayer_auth,
    rpt_payments,
)
from services.rpt_payment_service import initialize_rpt_demo_data

app = FastAPI(title="WARDS Queue Management System")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    ensure_security_columns(engine)
    db = SessionLocal()
    try:
        initialize_rpt_demo_data(db)
        backfill_security_hashes(db)
        apply_phase2_plaintext_redaction(db)
    finally:
        db.close()

# =========================
# 🔐 CORS CONFIG
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 📂 STATIC FILES (RECEIPTS)
# =========================
# Ensure folders exist BEFORE mounting
os.makedirs("input", exist_ok=True)
os.makedirs("output", exist_ok=True)

# Access via: http://localhost:8000/input/filename.jpg
app.mount(
    "/input",
    StaticFiles(directory="input"),
    name="input"
)

app.mount(
    "/output",
    StaticFiles(directory="output"),
    name="output"
)

# =========================
# 🚏 API ROUTES
# =========================
app.include_router(
    auth_simple.router,
    prefix="/api/auth",
    tags=["authentication"]
)

app.include_router(
    taxpayer_auth.router,
    prefix="/api/taxpayer-auth",
    tags=["taxpayer-authentication"]
)

app.include_router(
    admin_simple.router,
    prefix="/api/admin",
    tags=["admin"]
)

app.include_router(
    announcements.router,
    prefix="/api/announcements",
    tags=["announcements"]
)

app.include_router(
    services.router,
    prefix="/api/services",
    tags=["services"]
)

app.include_router(
    queue.router,
    prefix="/api/queue",
    tags=["queue"]
)

# 🔥 IMPORTANT FIX:
# receipts router ALREADY has prefix="/api/receipts"
# DO NOT add "/api" again
app.include_router(
    receipts.router
)

app.include_router(
    rpt_payments.router
)

# =========================
# ROOT HEALTH CHECK
# =========================
@app.get("/")
def read_root():
    return {
        "message": "WARDS Queue Management System API",
        "status": "running"
    }
