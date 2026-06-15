import os

os.environ.setdefault("DATA_ENCRYPTION_SECRET", "test-data-encryption-secret-do-not-use-in-production")
os.environ.setdefault("DATA_HASH_SECRET", "test-data-hash-secret-do-not-use-in-production")
os.environ.setdefault("LOG_INTEGRITY_SECRET", "test-log-integrity-secret-do-not-use-in-production")

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "WARDS" / "backend"

for candidate in (ROOT, BACKEND_ROOT):
    path_text = str(candidate)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)
