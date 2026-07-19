from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import GITHUB_TOKEN, USER_AGENT
from app.services.match import describe_rule, filter_assets


REPO_RE = re.compile(r"^/([^/]+)/([^/]+?)(?:\.git)?/?$")


def parse_repo(url: str) -> tuple[str, str]:
    raw = (url or "").strip()
    if raw.startswith("git@"):
        # git@github.com:owner/repo.git
        m = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$", raw)
        if not m:
            raise ValueError("无法解析 GitHub 仓库地址")
        return m.group(1), m.group(2).removesuffix(".git")

    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    host = (parsed.netloc or "").lower()
    if host not in {"github.com", "www.github.com"}:
        raise ValueError("请填写完整的 GitHub 仓库地址")
    m = REPO_RE.match(parsed.path or "")
    if not m:
        raise ValueError("无法解析 GitHub 仓库地址")
    owner, repo = m.group(1), m.group(2)
    if owner.lower() in {"orgs", "users", "settings"}:
        raise ValueError("无法解析 GitHub 仓库地址")
    return owner, repo


def default_name(url: str) -> str:
    try:
        owner, repo = parse_repo(url)
        return f"{owner}/{repo}"
    except Exception:
        return url


async def fetch_latest_release(
    url: str,
    *,
    include_prerelease: bool = True,
    filter_rule: dict[str, Any] | None = None,
) -> dict[str, Any]:
    owner, repo = parse_repo(url)
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    api = f"https://api.github.com/repos/{owner}/{repo}/releases?per_page=20"
    async with httpx.AsyncClient(timeout=30.0, headers=headers, follow_redirects=True) as client:
        resp = await client.get(api)
        if resp.status_code == 404:
            raise ValueError("仓库不存在或没有 Release")
        if resp.status_code == 403:
            raise ValueError("GitHub API 限流或无权限，可设置 GITHUB_TOKEN")
        resp.raise_for_status()
        releases = resp.json()

    if not isinstance(releases, list) or not releases:
        raise ValueError("该仓库暂无 Release")

    chosen = None
    for rel in releases:
        if rel.get("draft"):
            continue
        if not include_prerelease and rel.get("prerelease"):
            continue
        chosen = rel
        break

    if not chosen:
        raise ValueError("没有符合条件的正式版/预发布")

    assets_raw = chosen.get("assets") or []
    assets = [
        {
            "name": a.get("name") or "",
            "url": a.get("browser_download_url") or "",
            "size": a.get("size"),
        }
        for a in assets_raw
        if a.get("browser_download_url")
    ]

    matched, unmatched = filter_assets(assets, filter_rule)
    tag = chosen.get("tag_name") or chosen.get("name") or ""
    is_pre = bool(chosen.get("prerelease"))
    version = tag + (" (预发布)" if is_pre else "")
    rule_text = describe_rule(filter_rule)
    summary = f"{version} · 匹配 {len(matched)} 个文件"
    fingerprint = f"github|{owner}/{repo}|{tag}|{','.join(sorted(a['name'] for a in matched))}"

    return {
        "version": version,
        "title": chosen.get("name") or tag,
        "assets": matched,
        "unmatched_assets": unmatched,
        "netdisks": [],
        "summary": summary,
        "fingerprint": fingerprint,
        "rule_text": rule_text,
        "html_url": chosen.get("html_url") or f"https://github.com/{owner}/{repo}/releases",
        "tag": tag,
    }
