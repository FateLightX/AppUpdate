from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import USER_AGENT
from app.services.netdisk import extract_netdisks


def _normalize_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    return t


def extract_title(html: str, fallback: str = "") -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    if soup.title and soup.title.string:
        return _normalize_title(soup.title.string)
    h1 = soup.find("h1")
    if h1:
        return _normalize_title(h1.get_text(" ", strip=True))
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return _normalize_title(og["content"])
    return _normalize_title(fallback)


def default_name(url: str) -> str:
    try:
        host = urlparse(url).netloc
        return host or url
    except Exception:
        return url


async def fetch_article(url: str) -> dict[str, Any]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    async with httpx.AsyncClient(timeout=30.0, headers=headers, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    title = extract_title(html, fallback=url)
    netdisks = extract_netdisks(html, page_url=url)
    providers = sorted({n["provider"] for n in netdisks})
    summary = f"{title[:40]} · " + (" / ".join(providers) if providers else "未发现网盘")
    fingerprint = f"article|{url}|{title}|{','.join(sorted(n['url'] for n in netdisks))}"

    return {
        "version": title,
        "title": title,
        "assets": [],
        "unmatched_assets": [],
        "netdisks": netdisks,
        "summary": summary,
        "fingerprint": fingerprint,
        "html_url": url,
    }
