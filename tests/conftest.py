import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "WARDS" / "backend"

for candidate in (ROOT, BACKEND_ROOT):
    path_text = str(candidate)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)
