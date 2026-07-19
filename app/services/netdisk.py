from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup, NavigableString

# provider_id, label, host patterns, url regex
PROVIDERS = [
    ("baidu", "百度网盘", ["pan.baidu.com", "yun.baidu.com"], r"https?://(?:pan|yun)\.baidu\.com/s/[A-Za-z0-9_-]+(?:\?[^\s\"'<>]*)?"),
    ("aliyun", "阿里云盘", ["alipan.com", "aliyundrive.com"], r"https?://www\.(?:alipan|aliyundrive)\.com/s/[A-Za-z0-9_-]+"),
    ("quark", "夸克", ["pan.quark.cn"], r"https?://pan\.quark\.cn/s/[A-Za-z0-9_-]+"),
    ("123", "123", ["123pan.com", "123684.com", "123865.com", "123912.com"], r"https?://www\.(?:123pan|123684|123865|123912)\.com/s/[A-Za-z0-9_-]+"),
    ("tianyi", "天翼", ["cloud.189.cn"], r"https?://cloud\.189\.cn/(?:t/|web/share\?code=)[A-Za-z0-9_-]+"),
    ("lanzou", "蓝奏", ["lanzou", "lanzoui.com", "lanzoux.com", "lanzouw.com", "lanoso.com"], r"https?://[A-Za-z0-9.-]*(?:lanzou[a-z]*|lanoso)\.com/[A-Za-z0-9_-]+"),
]

CODE_PATTERNS = [
    re.compile(r"(?:提取码|密码|访问码|提取密碼|pwd|password|code)\s*[:：=]?\s*([A-Za-z0-9]{3,8})", re.I),
]


def _provider_for_url(url: str) -> tuple[str, str] | None:
    host = urlparse(url).netloc.lower()
    for pid, label, hosts, _ in PROVIDERS:
        for h in hosts:
            if h in host:
                return pid, label
    if "lanzou" in host or "lanoso" in host:
        return "lanzou", "蓝奏"
    return None


def _block_text(node) -> str:
    """Use the nearest small block (p/li/div/td/span) text only — avoid whole page bleed."""
    if not node:
        return ""
    cur = node
    for _ in range(5):
        if cur is None:
            break
        name = getattr(cur, "name", None)
        if name in {"p", "li", "td", "th", "span", "label", "blockquote", "pre", "code"}:
            return cur.get_text(" ", strip=True)
        if name in {"div", "section", "article"}:
            # only if short enough to look like a line/card
            t = cur.get_text(" ", strip=True)
            if len(t) <= 200:
                return t
        cur = cur.parent
    # fallback: own text + adjacent strings only
    parts: list[str] = []
    if node.parent:
        for child in node.parent.children:
            if child is node:
                parts.append(node.get_text(" ", strip=True) if hasattr(node, "get_text") else str(node))
            elif isinstance(child, NavigableString):
                parts.append(str(child).strip())
            elif getattr(child, "name", None) in {None, "br"}:
                continue
            elif child.name == "a" and child is not node:
                continue
            else:
                # neighboring inline text nodes only
                if getattr(child, "name", None) in {"span", "strong", "b", "em", "code"}:
                    parts.append(child.get_text(" ", strip=True))
    return " ".join(p for p in parts if p)


def _find_code(text: str) -> str:
    for pat in CODE_PATTERNS:
        m = pat.search(text or "")
        if m:
            return m.group(1)
    return ""


def _code_from_url(href: str) -> str:
    m = re.search(r"[?&](?:pwd|password|code)=([A-Za-z0-9]+)", href or "", re.I)
    return m.group(1) if m else ""


def _title_near(node, fallback: str = "") -> str:
    if not node:
        return fallback
    if node.has_attr("title") and node["title"].strip():
        return node["title"].strip()[:120]
    t = node.get_text(" ", strip=True)
    if t and not t.startswith("http"):
        return t[:120]
    return fallback


def extract_netdisks(html: str, page_url: str = "") -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    found: dict[str, dict[str, Any]] = {}

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href.startswith("http"):
            continue
        prov = _provider_for_url(href)
        if not prov:
            continue
        _, label = prov
        nearby = _block_text(a)
        code = _code_from_url(href) or _find_code(nearby) or _find_code(a.get_text(" ", strip=True))
        title = _title_near(a, label)
        key = href.split("?")[0]
        item = {
            "provider": label,
            "title": title[:120],
            "url": href,
            "code": code,
        }
        if key not in found or (code and not found[key].get("code")):
            found[key] = item

    # bare URLs in text lines
    text = soup.get_text("\n", strip=True)
    for _, label, _, pattern in PROVIDERS:
        for m in re.finditer(pattern, text, flags=re.I):
            href = m.group(0)
            key = href.split("?")[0]
            if key in found and found[key].get("code"):
                continue
            # only same visual line to avoid code bleed between links
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.end())
            if line_end < 0:
                line_end = len(text)
            line = text[line_start:line_end]
            code = _code_from_url(href) or _find_code(line)
            if key not in found:
                found[key] = {
                    "provider": label,
                    "title": label,
                    "url": href,
                    "code": code,
                }
            elif code and not found[key].get("code"):
                found[key]["code"] = code

    return list(found.values())
