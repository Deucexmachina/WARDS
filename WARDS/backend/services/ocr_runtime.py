import asyncio
import functools
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


OCR_MAX_WORKERS = _env_int("OCR_MAX_WORKERS", 2)
OCR_ROUTE_TIMEOUT_SECONDS = _env_int("OCR_ROUTE_TIMEOUT_SECONDS", 180)

_ocr_executor = ThreadPoolExecutor(max_workers=OCR_MAX_WORKERS, thread_name_prefix="wards-ocr")
_ocr_semaphore = asyncio.Semaphore(OCR_MAX_WORKERS)


async def run_ocr_in_executor(func: Callable[..., Any], *args, **kwargs) -> Any:
    async with _ocr_semaphore:
        loop = asyncio.get_running_loop()
        call = functools.partial(func, *args, **kwargs)
        return await asyncio.wait_for(
            loop.run_in_executor(_ocr_executor, call),
            timeout=OCR_ROUTE_TIMEOUT_SECONDS,
        )
