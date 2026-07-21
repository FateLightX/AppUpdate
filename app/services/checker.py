from __future__ import annotations

import logging
from typing import Any, Optional

from app import db
from app.services import article_svc, github_svc, netdisk_svc
from app.services.telegram_notify import format_update_message, send_telegram

log = logging.getLogger("appupdate.checker")


async def check_one(source: dict[str, Any], *, notify: bool = True) -> dict[str, Any]:
    if not source.get("enabled"):
        db.save_check_result(
            source["id"],
            {
                "status": "off",
                "summary": source.get("summary") or "已停用",
                "version": source.get("version") or "",
                "title": source.get("title") or "",
                "assets": source.get("assets") or [],
                "unmatched_assets": source.get("unmatchedAssets") or [],
                "netdisks": source.get("netdisks") or [],
                "fingerprint": source.get("fingerprint") or "",
                "last_error": "",
                "has_update": False,
            },
        )
        return {"id": source["id"], "ok": True, "updated": False, "skipped": True}

    old_fp = source.get("fingerprint") or ""
    try:
        if source["type"] == "github":
            result = await github_svc.fetch_latest_release(
                source["url"],
                include_prerelease=bool(source.get("includePrerelease", True)),
                filter_rule=source.get("filterRule") or {},
            )
        elif source["type"] == "netdisk":
            rule = source.get("filterRule") or {}
            result = await netdisk_svc.fetch_share(
                source["url"],
                code=str(rule.get("code") or ""),
            )
        else:
            result = await article_svc.fetch_article(source["url"])

        new_fp = result.get("fingerprint") or ""
        # First successful check should not flood as "update" if empty old fp?
        # Spec: notify on change. First run: treat as baseline without Telegram if old empty? 
        # User wants updates - first check establishing baseline is better without notify spam.
        is_change = bool(old_fp) and new_fp != old_fp
        is_first = not old_fp

        payload = {
            "status": "update" if is_change else "ok",
            "summary": result.get("summary") or "",
            "version": result.get("version") or "",
            "title": result.get("title") or "",
            "assets": result.get("assets") or [],
            "unmatched_assets": result.get("unmatched_assets") or [],
            "netdisks": result.get("netdisks") or [],
            "fingerprint": new_fp,
            "last_error": "",
            "has_update": is_change,
        }
        saved = db.save_check_result(source["id"], payload)

        if notify and is_change:
            settings = db.get_settings()
            if settings.get("telegramConfigured"):
                try:
                    text = format_update_message(source, result)
                    await send_telegram(settings["botToken"], settings["chatId"], text)
                except Exception as e:  # noqa: BLE001
                    log.warning("telegram failed for %s: %s", source["id"], e)

        return {
            "id": source["id"],
            "ok": True,
            "updated": is_change,
            "first": is_first,
            "source": saved,
        }
    except Exception as e:  # noqa: BLE001
        msg = str(e) or e.__class__.__name__
        db.save_check_result(
            source["id"],
            {
                "status": "error",
                "summary": f"检查失败：{msg}",
                "version": source.get("version") or "",
                "title": source.get("title") or "",
                "assets": source.get("assets") or [],
                "unmatched_assets": source.get("unmatchedAssets") or [],
                "netdisks": source.get("netdisks") or [],
                "fingerprint": source.get("fingerprint") or "",
                "last_error": msg,
                "has_update": bool(source.get("hasUpdate")),
            },
        )
        return {"id": source["id"], "ok": False, "error": msg, "updated": False}


async def check_all(*, only_id: Optional[int] = None, notify: bool = True) -> dict[str, Any]:
    sources = db.list_sources()
    if only_id is not None:
        sources = [s for s in sources if s["id"] == only_id]
    else:
        sources = [s for s in sources if s.get("enabled")]

    details = []
    updated = 0
    errors = 0
    for src in sources:
        detail = await check_one(src, notify=notify)
        details.append(detail)
        if detail.get("updated"):
            updated += 1
        if not detail.get("ok"):
            errors += 1
    return {
        "checked": len(details),
        "updated": updated,
        "errors": errors,
        "details": details,
    }
