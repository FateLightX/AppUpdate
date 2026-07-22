from __future__ import annotations

from typing import Any, Literal

import httpx

from app.config import USER_AGENT

TelegramDetail = Literal["compact", "full"]


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


def _clip(text: str, n: int = 48) -> str:
    s = (text or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


def _norm_detail(detail: str | None) -> TelegramDetail:
    return "full" if (detail or "").strip().lower() == "full" else "compact"


def format_update_message(
    source: dict[str, Any],
    result: dict[str, Any],
    *,
    detail: str | None = "compact",
) -> str:
    """Build a scannable Telegram update notice.

    compact: fewer items, with usable download URLs
    full: more items + URLs where useful
    """
    mode = _norm_detail(detail)
    name = source.get("name") or "未命名"
    src_type = source.get("type") or "article"
    lines: list[str] = [f"【更新】{_clip(str(name), 60)}"]

    if src_type == "github":
        lines.extend(_fmt_github(result, mode=mode))
    elif src_type == "netdisk":
        lines.extend(_fmt_netdisk(source, result, mode=mode))
    else:
        lines.extend(_fmt_article(result, mode=mode))

    src_url = source.get("url") or result.get("html_url") or ""
    if src_url:
        lines.append(f"原文：{src_url}")
    lines.append("详情见面板" if mode == "compact" else "详情也可在面板查看")
    return "\n".join(lines)


def _fmt_github(result: dict[str, Any], *, mode: TelegramDetail) -> list[str]:
    version = result.get("version") or "-"
    assets = result.get("assets") or []
    limit = 8 if mode == "full" else 4
    lines = [f"GitHub · {version} · 匹配 {len(assets)} 个"]
    if not assets:
        lines.append("下载：暂无匹配文件")
        return lines
    for a in assets[:limit]:
        name = _clip(str(a.get("name") or "file"), 52)
        lines.append(f"· {name}")
        if a.get("url"):
            # A file name alone is not actionable in Telegram. Keep compact mode
            # compact by limiting the asset count, not by dropping its link.
            lines.append(f"  {a['url']}")
    rest = len(assets) - limit
    if rest > 0:
        lines.append(f"… 另有 {rest} 个，见面板")
    return lines


def _fmt_article(result: dict[str, Any], *, mode: TelegramDetail) -> list[str]:
    title = _clip(str(result.get("title") or "-"), 56)
    disks = result.get("netdisks") or []
    lines = [f"文章 · {title}"]
    if not disks:
        lines.append("网盘：未发现")
        return lines
    providers = []
    for d in disks:
        p = (d.get("provider") or "").strip()
        if p and p not in providers:
            providers.append(p)
    lines.append(f"网盘 {len(disks)} · " + ("/".join(providers[:4]) if providers else "-"))
    limit = 8 if mode == "full" else 3
    for d in disks[:limit]:
        prov = d.get("provider") or "网盘"
        code = f" 码 {d['code']}" if d.get("code") else ""
        title_s = _clip(str(d.get("title") or ""), 28)
        head = f"· [{prov}] {title_s}".rstrip()
        lines.append(f"{head}{code}")
        if mode == "full" and d.get("url"):
            lines.append(f"  {d['url']}")
    rest = len(disks) - limit
    if rest > 0:
        lines.append(f"… 另有 {rest} 条，见面板")
    return lines


def _fmt_netdisk(source: dict[str, Any], result: dict[str, Any], *, mode: TelegramDetail) -> list[str]:
    title = _clip(str(result.get("title") or "-"), 48)
    mode_label = result.get("probeModeLabel") or ""
    if not mode_label:
        disks0 = (result.get("netdisks") or [{}])[0]
        mode_label = disks0.get("modeLabel") or (
            "页面指纹" if disks0.get("mode") == "fingerprint" else "文件列表"
        )
    assets = result.get("assets") or []
    lines = [f"网盘 · {title} · {mode_label} · {len(assets)} 项"]
    limit = 10 if mode == "full" else 5
    if assets:
        for a in assets[:limit]:
            name = _clip(str(a.get("name") or "未命名"), 48)
            size = a.get("size")
            size_s = f" · {size}" if isinstance(size, int) else ""
            lines.append(f"· {name}{size_s}")
        rest = len(assets) - limit
        if rest > 0:
            lines.append(f"… 另有 {rest} 项，见面板")
    disks = result.get("netdisks") or []
    if disks:
        d = disks[0]
        url = d.get("url") or source.get("url") or ""
        code = f" 提取码 {d['code']}" if d.get("code") else ""
        if url:
            # one line for link; avoid duplicating huge lists
            lines.append(f"链接：{url}{code}")
        elif code:
            lines.append(code.strip())
    return lines
