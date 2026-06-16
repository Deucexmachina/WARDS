"""Process-wide startup tweaks for local backend runs.

Python imports this module automatically when the backend directory is on
sys.path. Keep it tiny: it exists to prevent Uvicorn reload logs from exposing
the absolute local project path before the FastAPI app is imported.
"""

try:
    from utils.log_sanitization import install_uvicorn_reload_path_filter
except Exception:
    install_uvicorn_reload_path_filter = None

if install_uvicorn_reload_path_filter:
    install_uvicorn_reload_path_filter()
