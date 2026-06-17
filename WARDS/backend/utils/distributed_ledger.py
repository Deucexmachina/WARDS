"""Append-only distributed ledger for high-value transactions.

Each entry is cryptographically chained to the previous entry,
forming a tamper-evident audit trail for payments, remittances,
and other high-value state changes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    MASTER_ROOT = Path(__file__).resolve().parents[3]
except IndexError:
    MASTER_ROOT = Path("/")
LEDGER_DIR = Path(os.getenv("DISTRIBUTED_LEDGER_DIR", str(MASTER_ROOT / "DATABASE" / "ledger")))
LEDGER_FILE = LEDGER_DIR / "high_value_transactions.jsonl"
INTEGRITY_SECRET = os.getenv("LEDGER_INTEGRITY_SECRET", os.getenv("LOG_INTEGRITY_SECRET", ""))

_lock = threading.Lock()


def _ensure_dir() -> None:
    LEDGER_DIR.mkdir(parents=True, exist_ok=True)


def _hash_entry(entry: dict[str, Any]) -> str:
    canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"), default=str)
    return hmac.new(INTEGRITY_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def _last_entry_hash() -> str | None:
    _ensure_dir()
    if not LEDGER_FILE.exists():
        return None
    with open(LEDGER_FILE, "r", encoding="utf-8") as fh:
        last_line = ""
        for line in fh:
            line = line.strip()
            if line:
                last_line = line
        if last_line:
            try:
                return json.loads(last_line)["entry_hash"]
            except (json.JSONDecodeError, KeyError):
                return None
    return None


def append_ledger_entry(
    entry_type: str,
    record_id: int | str,
    actor: str,
    action: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Append an entry to the distributed ledger and return the entry."""
    with _lock:
        previous_hash = _last_entry_hash()
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "entry_type": entry_type,
            "record_id": str(record_id),
            "actor": actor,
            "action": action,
            "data": data,
            "previous_hash": previous_hash or "genesis",
        }
        entry["entry_hash"] = _hash_entry(entry)
        _ensure_dir()
        with open(LEDGER_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, separators=(",", ":"), default=str) + "\n")
        return entry


def verify_ledger_integrity() -> list[dict[str, Any]]:
    """Verify the entire ledger chain. Returns violations."""
    violations = []
    previous_hash = "genesis"
    if not LEDGER_FILE.exists():
        return violations
    with open(LEDGER_FILE, "r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                violations.append({"line": line_no, "error": "invalid JSON"})
                continue
            stored_entry_hash = entry.pop("entry_hash", None)
            computed = _hash_entry(entry)
            if stored_entry_hash != computed:
                violations.append({
                    "line": line_no,
                    "error": "entry_hash mismatch",
                    "stored": stored_entry_hash,
                    "computed": computed,
                })
            if entry.get("previous_hash") != previous_hash:
                violations.append({
                    "line": line_no,
                    "error": "chain_break",
                    "expected_previous": previous_hash,
                    "actual_previous": entry.get("previous_hash"),
                })
            previous_hash = stored_entry_hash
    return violations


def ledger_tail(limit: int = 100) -> list[dict[str, Any]]:
    """Return the last N ledger entries."""
    if not LEDGER_FILE.exists():
        return []
    with open(LEDGER_FILE, "r", encoding="utf-8") as fh:
        lines = [line.strip() for line in fh if line.strip()]
    entries = []
    for line in lines[-limit:]:
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries
