from __future__ import annotations

from typing import Any

import httpx

from app.config import USER_AGENT


async def send_telegram(bot_token: str, chat_id: str, text: str) -> None:
    token = (bot_token or "").strip()
    chat = (chat_id or "").strip()
    if not token or not chat:
        return
    api = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat,
        "text": text,
        "disable_web_page_preview": True,
    }
    async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.post(api, json=payload)
        if resp.status_code >= 400:
            raise ValueError(f"Telegram 推送失败：{resp.status_code} {resp.text[:200]}")


def format_update_message(source: dict[str, Any], result: dict[str, Any]) -> str:
    name = source.get("name") or "未命名"
    lines = [f"【更新】{name}"]
    if source.get("type") == "github":
        lines.append(f"版本：{result.get('version') or '-'}")
        assets = result.get("assets") or []
        if assets:
            lines.append("下载：")
            for a in assets[:8]:
                lines.append(f"· {a.get('name')}")
                if a.get("url"):
                    lines.append(f"  {a['url']}")
            if len(assets) > 8:
                lines.append(f"… 另有 {len(assets) - 8} 个文件")
        else:
            lines.append("下载：暂无匹配文件")
    elif source.get("type") == "netdisk":
        lines.append(f"分享：{result.get('title') or '-'}")
        assets = result.get("assets") or []
        if assets:
            lines.append("文件：")
            for a in assets[:12]:
                size = a.get("size")
                size_s = f" ({size})" if size not in (None, "") else ""
                lines.append(f"· {a.get('name')}{size_s}")
            if len(assets) > 12:
                lines.append(f"… 另有 {len(assets) - 12} 项")
        disks = result.get("netdisks") or []
        if disks:
            d = disks[0]
            code = f" 提取码 {d['code']}" if d.get("code") else ""
            lines.append(f"链接：{d.get('url')}{code}")
    else:
        lines.append(f"标题：{result.get('title') or '-'}")
        disks = result.get("netdisks") or []
        if disks:
            lines.append("网盘：")
            for d in disks[:8]:
                code = f" 提取码 {d['code']}" if d.get("code") else ""
                lines.append(f"· [{d.get('provider')}] {d.get('title') or ''}{code}")
                lines.append(f"  {d.get('url')}")
            if len(disks) > 8:
                lines.append(f"… 另有 {len(disks) - 8} 条")
        else:
            lines.append("网盘：未发现")
    src_url = source.get("url") or result.get("html_url") or ""
    if src_url:
        lines.append(f"原文：{src_url}")
    return "\n".join(lines)
