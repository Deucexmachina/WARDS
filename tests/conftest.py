import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "WARDS" / "backend"

# Load environment variables before backend modules import database/models.py
ENV_PATH = BACKEND_ROOT / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=str(ENV_PATH), override=False)

for candidate in (ROOT, BACKEND_ROOT):
    path_text = str(candidate)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)


import pytest


@pytest.fixture(autouse=True)
def reset_auth_rate_limiter_state():
    try:
        from routes import unified_auth

        unified_auth.limiter.reset()
    except Exception:
        pass
