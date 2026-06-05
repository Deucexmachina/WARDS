import asyncio
import functools
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


OCR_MAX_WORKERS = _env_int("OCR_MAX_WORKERS", 2)
OCR_ROUTE_TIMEOUT_SECONDS = _env_int("OCR_ROUTE_TIMEOUT_SECONDS", 240)

_executor_lock = threading.Lock()
_ocr_executor = ThreadPoolExecutor(max_workers=OCR_MAX_WORKERS, thread_name_prefix="wards-ocr")
_ocr_semaphore = asyncio.Semaphore(OCR_MAX_WORKERS)


def _get_ocr_executor() -> ThreadPoolExecutor:
    with _executor_lock:
        return _ocr_executor


def _replace_ocr_executor() -> None:
    """Move future OCR work to a fresh pool when a worker is abandoned by timeout."""
    global _ocr_executor

    with _executor_lock:
        stale_executor = _ocr_executor
        _ocr_executor = ThreadPoolExecutor(max_workers=OCR_MAX_WORKERS, thread_name_prefix="wards-ocr")

    stale_executor.shutdown(wait=False, cancel_futures=True)


async def run_ocr_in_executor(func: Callable[..., Any], *args, **kwargs) -> Any:
    async with _ocr_semaphore:
        loop = asyncio.get_running_loop()
        call = functools.partial(func, *args, **kwargs)
        future = loop.run_in_executor(_get_ocr_executor(), call)
        try:
            return await asyncio.wait_for(future, timeout=OCR_ROUTE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            future.cancel()
            _replace_ocr_executor()
            raise
