from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app import auth, db
from app.models import SettingsUpdate
from app.scheduler import reschedule_from_settings
from app.services.telegram_notify import send_telegram

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _public(settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "intervalHours": settings["intervalHours"],
        "botToken": "",  # never echo full token
        "chatId": settings["chatId"],
        "telegramConfigured": settings["telegramConfigured"],
        "hasToken": settings["hasToken"],
        "tokenMasked": ("••••" + settings["botToken"][-4:]) if settings.get("botToken") else "",
        "hasPanelPassword": bool(settings.get("hasPanelPassword")),
        "telegramDetail": settings.get("telegramDetail") or "compact",
    }


@router.get("")
def get_settings() -> dict[str, Any]:
    return _public(db.get_settings())


@router.put("")
async def put_settings(body: SettingsUpdate) -> dict[str, Any]:
    data = body.model_dump(by_alias=False, exclude_unset=True)
    if "interval_hours" in data and data["interval_hours"] is not None:
        if int(data["interval_hours"]) < 1:
            raise HTTPException(400, "检查间隔至少 1 小时")

    panel_password_hash = None
    clear = bool(data.get("clear_panel_password"))
    new_pw = data.get("panel_password")
    if clear:
        panel_password_hash = ""
        auth.revoke_all_sessions()
    elif new_pw is not None:
        pw = str(new_pw).strip()
        if pw:
            if len(pw) < 4:
                raise HTTPException(400, "面板密码至少 4 位")
            panel_password_hash = auth.hash_password(pw)
            auth.revoke_all_sessions()
        # empty string without clear => ignore (do not change)

    telegram_detail = data.get("telegram_detail")
    if telegram_detail is not None:
        telegram_detail = "full" if str(telegram_detail).strip().lower() == "full" else "compact"

    updated = db.update_settings(
        interval_hours=data.get("interval_hours"),
        bot_token=data.get("bot_token"),
        chat_id=data.get("chat_id"),
        panel_password_hash=panel_password_hash,
        telegram_detail=telegram_detail,
    )
    reschedule_from_settings()
    return _public(updated)


@router.post("/telegram/test")
async def test_telegram() -> dict[str, str]:
    settings = db.get_settings()
    if not settings["telegramConfigured"]:
        raise HTTPException(400, "请先填写 Bot Token 和 Chat ID")
    detail_label = "详细" if settings.get("telegramDetail") == "full" else "简洁"
    await send_telegram(
        settings["botToken"],
        settings["chatId"],
        "【更新追踪】测试消息：连接正常。\n当前推送：" + detail_label + "\n详情见面板",
    )
    return {"ok": "true", "message": "测试消息已发送"}
