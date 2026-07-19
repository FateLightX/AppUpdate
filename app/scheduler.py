from __future__ import annotations

import asyncio
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app import db
from app.services.checker import check_all

log = logging.getLogger("appupdate.scheduler")

_scheduler: Optional[AsyncIOScheduler] = None
_lock = asyncio.Lock()


async def run_check_job() -> None:
    if _lock.locked():
        log.info("skip check: previous still running")
        return
    async with _lock:
        log.info("scheduled check start")
        try:
            result = await check_all(notify=True)
            log.info(
                "scheduled check done checked=%s updated=%s errors=%s",
                result["checked"],
                result["updated"],
                result["errors"],
            )
        except Exception:  # noqa: BLE001
            log.exception("scheduled check failed")


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


def reschedule_from_settings() -> None:
    scheduler = get_scheduler()
    settings = db.get_settings()
    hours = max(1, int(settings.get("intervalHours") or 6))
    job_id = "periodic_check"
    if scheduler.get_job(job_id):
        scheduler.reschedule_job(job_id, trigger=IntervalTrigger(hours=hours))
    else:
        scheduler.add_job(
            run_check_job,
            trigger=IntervalTrigger(hours=hours),
            id=job_id,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
    log.info("scheduler interval set to %s hours", hours)


def start_scheduler() -> None:
    scheduler = get_scheduler()
    if not scheduler.running:
        reschedule_from_settings()
        scheduler.start()
        log.info("scheduler started")


def shutdown_scheduler() -> None:
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
        log.info("scheduler stopped")
