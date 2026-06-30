"""In-memory background job queue with progress tracking and rate limiting."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    id: str
    type: str
    status: JobStatus = JobStatus.PENDING
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    progress: int = 0  # 0-100
    current_step: str = ""
    result: Any = None
    error: str | None = None


class BackgroundJobManager:
    """Simple in-memory background job manager with rate limiting."""

    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_run: dict[str, float] = {}
        self._min_intervals: dict[str, float] = {}
        self._max_jobs = max(50, int(os.getenv("BACKGROUND_JOB_MAX_ITEMS", "500")))
        self._retention_seconds = max(300, int(os.getenv("BACKGROUND_JOB_RETENTION_SECONDS", str(6 * 60 * 60))))

    def set_rate_limit(self, job_type: str, min_interval_seconds: float) -> None:
        self._min_intervals[job_type] = min_interval_seconds

    def _check_rate_limit(self, job_type: str) -> bool:
        min_interval = self._min_intervals.get(job_type, 0)
        if min_interval <= 0:
            return True
        last = self._last_run.get(job_type, 0)
        return (time.time() - last) >= min_interval

    def _rate_limit_remaining(self, job_type: str) -> float:
        min_interval = self._min_intervals.get(job_type, 0)
        last = self._last_run.get(job_type, 0)
        remaining = min_interval - (time.time() - last)
        return max(0.0, remaining)

    def cleanup(self) -> None:
        now = time.time()
        expired = [
            job_id for job_id, job in self._jobs.items()
            if job.status in {JobStatus.COMPLETED, JobStatus.FAILED}
            and job.completed_at
            and now - job.completed_at > self._retention_seconds
        ]
        for job_id in expired:
            self._jobs.pop(job_id, None)
            self._locks.pop(job_id, None)

        if len(self._jobs) <= self._max_jobs:
            return
        removable = sorted(
            [
                job for job in self._jobs.values()
                if job.status in {JobStatus.COMPLETED, JobStatus.FAILED}
            ],
            key=lambda item: item.completed_at or item.created_at,
        )
        for job in removable[: max(0, len(self._jobs) - self._max_jobs)]:
            self._jobs.pop(job.id, None)
            self._locks.pop(job.id, None)

    def _has_active_job(self, job_type: str) -> bool:
        return any(
            job.type == job_type and job.status in {JobStatus.PENDING, JobStatus.RUNNING}
            for job in self._jobs.values()
        )

    def submit(self, job_type: str) -> Job:
        self.cleanup()
        if self._has_active_job(job_type):
            raise RateLimitExceeded(f"A {job_type} job is already pending or running.")
        if not self._check_rate_limit(job_type):
            raise RateLimitExceeded(
                f"Rate limit exceeded for {job_type}. "
                f"Try again in {int(self._rate_limit_remaining(job_type))}s."
            )
        self._last_run[job_type] = time.time()
        job = Job(id=str(uuid.uuid4()), type=job_type)
        self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def update_progress(self, job_id: str, progress: int, current_step: str = "") -> None:
        job = self._jobs.get(job_id)
        if job:
            job.progress = min(max(progress, 0), 100)
            if current_step:
                job.current_step = current_step

    def _start(self, job_id: str) -> None:
        job = self._jobs.get(job_id)
        if job:
            job.status = JobStatus.RUNNING
            job.started_at = time.time()

    def _complete(self, job_id: str, result: Any) -> None:
        job = self._jobs.get(job_id)
        if job:
            job.status = JobStatus.COMPLETED
            job.completed_at = time.time()
            job.progress = 100
            job.result = result

    def _fail(self, job_id: str, error: str) -> None:
        job = self._jobs.get(job_id)
        if job:
            job.status = JobStatus.FAILED
            job.completed_at = time.time()
            job.error = error

    async def run(self, job_id: str, coro: Callable[[], Coroutine[Any, Any, Any]]) -> None:
        lock = self._locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            self._start(job_id)
            try:
                result = await coro()
                self._complete(job_id, result)
            except Exception as exc:
                self._fail(job_id, str(exc))
                raise


class RateLimitExceeded(Exception):
    pass


# Global singleton
job_manager = BackgroundJobManager()
for _job_type, _interval in {
    "security_full_scan": 30,
    "security_manual_backup": 120,
    "security_vm1_database_backup": 120,
    "security_vm2_database_backup": 120,
    "security_files_backup": 120,
    "security_ml_backup": 60,
    "security_full_backup": 180,
    "security_full_recovery": 300,
    "security_vm1_database_recovery": 300,
    "security_vm2_database_recovery": 300,
    "security_files_recovery": 180,
    "security_ml_recovery": 120,
    "security_file_scan": 10,
    "security_file_recovery": 30,
}.items():
    job_manager.set_rate_limit(_job_type, _interval)
