"""In-memory background job queue with progress tracking and rate limiting."""

from __future__ import annotations

import asyncio
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

    def submit(self, job_type: str) -> Job:
        if not self._check_rate_limit(job_type):
            raise RateLimitExceeded(
                f"Rate limit exceeded for {job_type}. "
                f"Try again in {int(self._rate_limit_remaining(job_type))}s."
            )
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
            self._last_run[job.type] = time.time()

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
# Rate-limit full scans to once every 30 seconds
job_manager.set_rate_limit("security_full_scan", 30)
