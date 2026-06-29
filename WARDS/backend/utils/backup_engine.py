import gzip
import hashlib
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)
DEFAULT_DATABASE_BACKUP_RETENTION_LIMIT = 10


@dataclass
class BackupResult:
    filename: str
    path: Path
    size_bytes: int
    checksum: str
    db_type: str


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required for database backup operations")
    return value


def backup_dir() -> Path:
    path = Path(os.getenv("BACKUP_DIR", "./backups")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def database_backup_retention_limit() -> int:
    try:
        return max(1, int(os.getenv("VM1_DATABASE_BACKUP_RETENTION_LIMIT", str(DEFAULT_DATABASE_BACKUP_RETENTION_LIMIT))))
    except (TypeError, ValueError):
        return DEFAULT_DATABASE_BACKUP_RETENTION_LIMIT


def prune_database_backups(backup_location: Path | None = None, keep: int | None = None) -> int:
    """Keep only the newest VM1 database dump files in the backup directory."""
    location = backup_location or backup_dir()
    keep_count = database_backup_retention_limit() if keep is None else max(1, int(keep))
    if not location.exists() or not location.is_dir():
        return 0
    backups = sorted(
        [item for item in location.iterdir() if item.is_file() and item.name.startswith("database_") and item.name.endswith(".sql.gz")],
        key=lambda item: item.name,
    )
    removed = 0
    for old_backup in backups[:-keep_count]:
        try:
            old_backup.unlink()
            removed += 1
        except OSError as exc:
            logger.warning("Failed to remove old VM1 database backup %s: %s", old_backup, exc)
    return removed


def _db_type(database_url: str) -> str:
    scheme = urlparse(database_url).scheme.lower()
    if scheme.startswith("postgres"):
        return "postgresql"
    if scheme.startswith("mysql"):
        return "mysql"
    if scheme.startswith("sqlite"):
        return "sqlite"
    raise RuntimeError(f"Unsupported DATABASE_URL scheme for backup: {scheme}")


def _dump_command(database_url: str, db_type: str) -> list[str]:
    parsed = urlparse(database_url)
    if db_type == "postgresql":
        command = ["pg_dump", "--no-owner", "--no-privileges"]
        if parsed.hostname:
            command += ["--host", parsed.hostname]
        if parsed.port:
            command += ["--port", str(parsed.port)]
        if parsed.username:
            command += ["--username", parsed.username]
        command.append((parsed.path or "").lstrip("/"))
        return command
    if db_type == "mysql":
        command = ["mysqldump", "--skip-ssl"]
        if parsed.hostname:
            command += ["--host", parsed.hostname]
        if parsed.port:
            command += ["--port", str(parsed.port)]
        if parsed.username:
            command += ["--user", parsed.username]
        if parsed.password:
            command.append(f"--password={parsed.password}")
        command.append((parsed.path or "").lstrip("/"))
        return command
    raise RuntimeError(f"External dump command is not supported for {db_type}")


def _restore_command(database_url: str, db_type: str) -> list[str]:
    parsed = urlparse(database_url)
    if db_type == "postgresql":
        command = ["psql"]
        if parsed.hostname:
            command += ["--host", parsed.hostname]
        if parsed.port:
            command += ["--port", str(parsed.port)]
        if parsed.username:
            command += ["--username", parsed.username]
        command.append((parsed.path or "").lstrip("/"))
        return command
    if db_type == "mysql":
        command = ["mysql"]
        if parsed.hostname:
            command += ["--host", parsed.hostname]
        if parsed.port:
            command += ["--port", str(parsed.port)]
        if parsed.username:
            command += ["--user", parsed.username]
        if parsed.password:
            command.append(f"--password={parsed.password}")
        command.append((parsed.path or "").lstrip("/"))
        return command
    raise RuntimeError(f"External restore command is not supported for {db_type}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_database_backup() -> BackupResult:
    database_url = _database_url()
    db_type = _db_type(database_url)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    output_path = backup_dir() / f"database_{timestamp}.sql.gz"

    if db_type == "sqlite":
        parsed = urlparse(database_url)
        db_path = Path(parsed.path).resolve()
        with db_path.open("rb") as source, gzip.open(output_path, "wb") as target:
            shutil.copyfileobj(source, target)
    else:
        command = _dump_command(database_url, db_type)
        with gzip.open(output_path, "wb") as target:
            result = subprocess.run(command, stdout=target, stderr=subprocess.PIPE)
        stderr_text = result.stderr.decode("utf-8", errors="ignore") if result.stderr else ""
        # mysqldump exit code 2 = completed with warnings; treat as success
        if result.returncode == 0 or (db_type == "mysql" and result.returncode == 2):
            if stderr_text:
                import logging
                logging.getLogger(__name__).warning("mysqldump stderr: %s", stderr_text)
        else:
            raise RuntimeError(
                f"Database dump failed (exit {result.returncode}). stderr: {stderr_text}"
            )

    checksum = sha256_file(output_path)
    prune_database_backups(output_path.parent)
    return BackupResult(
        filename=output_path.name,
        path=output_path,
        size_bytes=output_path.stat().st_size,
        checksum=checksum,
        db_type=db_type,
    )


def restore_database_backup(path: Path, expected_checksum: str | None, db_type: str | None = None) -> None:
    path = Path(path).resolve()
    if not path.exists():
        raise RuntimeError("Backup file is missing from disk")
    if expected_checksum and sha256_file(path) != expected_checksum:
        raise RuntimeError("Backup checksum mismatch")

    database_url = _database_url()
    resolved_db_type = db_type or _db_type(database_url)
    if resolved_db_type == "sqlite":
        parsed = urlparse(database_url)
        db_path = Path(parsed.path).resolve()
        with gzip.open(path, "rb") as source, db_path.open("wb") as target:
            shutil.copyfileobj(source, target)
        return

    command = _restore_command(database_url, resolved_db_type)
    with gzip.open(path, "rb") as source:
        subprocess.run(command, stdin=source, stderr=subprocess.PIPE, check=True)
