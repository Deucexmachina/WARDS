from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


DEFAULT_SERVICE_NAME = os.getenv("WAZUH_SERVICE_NAME", "WazuhSvc").strip() or "WazuhSvc"


def configure_logging(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("wazuh_admin_helper")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


def validate_config_path(config_path: Path) -> Path:
    resolved = config_path.expanduser().resolve(strict=False)
    if resolved.name.lower() != "ossec.conf":
        raise ValueError("Only ossec.conf can be modified by the Wazuh helper.")
    return resolved


def validate_directories(raw_directories: list[str]) -> list[Path]:
    if not isinstance(raw_directories, list) or not raw_directories:
        raise ValueError("At least one monitored directory is required.")
    validated: list[Path] = []
    seen: set[str] = set()
    for item in raw_directories:
        path = Path(str(item)).expanduser().resolve(strict=False)
        if not path.is_absolute():
            raise ValueError(f"Monitored directory must be absolute: {item}")
        if not path.exists() or not path.is_dir():
            raise ValueError(f"Monitored directory does not exist: {path}")
        normalized = str(path).lower() if os.name == "nt" else str(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        validated.append(path)
    return sorted(validated, key=lambda value: str(value))


def load_tree(config_path: Path) -> tuple[ET.ElementTree, ET.Element]:
    if config_path.exists():
        tree = ET.parse(config_path)
        root = tree.getroot()
    else:
        root = ET.Element("ossec_config")
        tree = ET.ElementTree(root)
    syscheck = root.find("syscheck")
    if syscheck is None:
        syscheck = ET.SubElement(root, "syscheck")
        ET.SubElement(syscheck, "frequency").text = "300"
        ET.SubElement(syscheck, "scan_on_start").text = "yes"
        ET.SubElement(syscheck, "alert_new_files").text = "yes"
    return tree, syscheck


def validate_tree(tree: ET.ElementTree) -> None:
    root = tree.getroot()
    if root.tag != "ossec_config":
        raise ValueError("Invalid Wazuh XML root.")
    syscheck = root.find("syscheck")
    if syscheck is None:
        raise ValueError("Missing syscheck section.")
    for item in syscheck.findall("directories"):
        text = (item.text or "").strip()
        if not text:
            raise ValueError("Empty Wazuh directories entry detected.")
        if not Path(text).is_absolute():
            raise ValueError(f"Wazuh directory is not absolute: {text}")


def sync_directories(config_path: Path, directories: list[Path]) -> tuple[bool, ET.ElementTree]:
    tree, syscheck = load_tree(config_path)
    desired = {str(path).lower() if os.name == "nt" else str(path): path for path in directories}
    existing = {
        ((item.text or "").strip().lower() if os.name == "nt" else (item.text or "").strip()): item
        for item in syscheck.findall("directories")
        if (item.text or "").strip()
    }
    changed = False

    for normalized, item in list(existing.items()):
        if normalized not in desired:
            syscheck.remove(item)
            changed = True

    for normalized, path in desired.items():
        if normalized in existing:
            continue
        item = ET.SubElement(syscheck, "directories")
        item.set("check_all", "yes")
        item.set("realtime", "yes")
        item.set("report_changes", "yes")
        item.text = str(path)
        changed = True

    validate_tree(tree)
    return changed, tree


def write_tree(config_path: Path, tree: ET.ElementTree) -> Path | None:
    backup_path = None
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        backup_path = config_path.with_name(f"{config_path.name}.{Path(config_path.name).stem}.{os.getpid()}.bak")
        shutil.copy2(config_path, backup_path)
    temp_path = config_path.with_suffix(f"{config_path.suffix}.tmp")
    tree.write(temp_path, encoding="utf-8", xml_declaration=False)
    ET.parse(temp_path)
    temp_path.replace(config_path)
    return backup_path


def restart_wazuh_service(logger: logging.Logger) -> bool:
    if os.name != "nt":
        return False
    if os.getenv("WAZUH_SERVICE_RESTART_ENABLED", "true").strip().lower() != "true":
        logger.info("Skipping Wazuh service restart because WAZUH_SERVICE_RESTART_ENABLED is false.")
        return False
    logger.info("Restarting Wazuh service '%s'.", DEFAULT_SERVICE_NAME)
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"Restart-Service -Name '{DEFAULT_SERVICE_NAME}' -Force",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "").strip() or "Wazuh service restart failed.")
    return True


def write_result(result_path: Path, payload: dict) -> None:
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Elevated helper for Wazuh configuration changes.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()

    payload_path = Path(args.payload)
    result_path = Path(args.result)

    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        log_path = Path(str(payload.get("log_path") or Path(result_path).with_suffix(".log")))
        logger = configure_logging(log_path)
        logger.info("Started elevated Wazuh helper request.")

        config_path = validate_config_path(Path(str(payload["config_path"])))
        directories = validate_directories(payload.get("directories") or [])
        logger.info("Updating '%s' with %s monitored directorie(s).", config_path, len(directories))

        changed, tree = sync_directories(config_path, directories)
        backup_path = None
        reloaded = False
        if changed:
            backup_path = write_tree(config_path, tree)
            logger.info("Wazuh configuration updated successfully.")
            try:
                reloaded = restart_wazuh_service(logger)
            except Exception:
                logger.exception("Wazuh service restart failed; restoring previous configuration.")
                if backup_path and backup_path.exists():
                    shutil.copy2(backup_path, config_path)
                raise
        else:
            logger.info("No Wazuh configuration changes were necessary.")

        write_result(result_path, {
            "success": True,
            "updated": changed,
            "reloaded": reloaded,
            "backup_path": str(backup_path) if backup_path else None,
            "message": "Wazuh configuration synchronized successfully.",
        })
        return 0
    except Exception as exc:
        try:
            logger = logging.getLogger("wazuh_admin_helper")
            logger.exception("Elevated Wazuh helper failed.")
        except Exception:
            pass
        write_result(result_path, {
            "success": False,
            "updated": False,
            "reloaded": False,
            "message": str(exc),
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
