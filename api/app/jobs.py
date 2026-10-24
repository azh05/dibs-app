"""In-memory background jobs for slow Bright Data work (Instagram jobs take 2 to 5 minutes).

Local only: jobs live in this process and are gone after a restart. Fine for a hackathon demo.
"""
from __future__ import annotations

import logging
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import Executor, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Optional

from .errors import http_error
from .schemas import JobError, JobStatus, SearchResponse

log = logging.getLogger(__name__)

JobFn = Callable[[Callable[[str], None]], SearchResponse]


class JobStore:
    def __init__(self, executor: Optional[Executor] = None, keep: int = 100):
        self._jobs: OrderedDict[str, JobStatus] = OrderedDict()
        self._lock = threading.Lock()
        self._executor = executor or ThreadPoolExecutor(max_workers=2)
        self._keep = keep

    def submit(self, fn: JobFn) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = JobStatus(job_id=job_id, status="queued", created_at=datetime.now(timezone.utc))
            while len(self._jobs) > self._keep:
                self._jobs.popitem(last=False)
        self._executor.submit(self._run, job_id, fn)
        return job_id

    def get(self, job_id: str) -> Optional[JobStatus]:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def _update(self, job_id: str, **changes) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                self._jobs[job_id] = job.model_copy(update=changes)

    def _progress(self, job_id: str, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.progress.append(message)

    def _run(self, job_id: str, fn: JobFn) -> None:
        self._update(job_id, status="running")
        try:
            result = fn(lambda msg: self._progress(job_id, msg))
        except Exception as exc:
            mapped = http_error(exc)
            if mapped is None:
                log.exception("job %s crashed", job_id)
                mapped = (500, f"internal error: {exc.__class__.__name__}")
            self._update(job_id, status="failed", error=JobError(status_code=mapped[0], detail=mapped[1]))
            return
        self._update(job_id, status="done", result=result)
