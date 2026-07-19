from __future__ import annotations

import re
from typing import Any

OS_OPTIONS = [
    {
        "id": "macos",
        "label": "macOS",
        "aliases": ["macos", "mac-os", "mac_os", "darwin", "osx", "apple"],
    },
    {
        "id": "windows",
        "label": "Windows",
        "aliases": ["windows", "win32", "win64", "win", "msvc", "pc-windows"],
    },
    {
        "id": "linux",
        "label": "Linux",
        "aliases": ["linux", "gnu", "ubuntu", "debian", "appimage", "rpm", "deb"],
    },
    {
        "id": "android",
        "label": "Android",
        "aliases": ["android", "apk", "aab"],
    },
]

ARCH_OPTIONS = [
    {
        "id": "arm64",
        "label": "arm64",
        "aliases": ["arm64", "aarch64", "arm64e", "arm64v8", "armv8", "arm64-v8a"],
    },
    {
        "id": "x64",
        "label": "x64",
        "aliases": ["x64", "x86_64", "x86-64", "amd64", "win64", "64bit", "64-bit"],
    },
    {
        "id": "x86",
        "label": "x86",
        "aliases": ["x86", "i386", "i686", "ia32", "win32", "32bit", "32-bit"],
    },
    {
        "id": "armv7",
        "label": "armv7",
        "aliases": ["armv7", "armv7l", "armeabi-v7a", "armeabi", "armhf"],
    },
]

EXT_OPTIONS = [
    ".dmg",
    ".pkg",
    ".zip",
    ".tar.gz",
    ".tgz",
    ".7z",
    ".exe",
    ".msi",
    ".AppImage",
    ".deb",
    ".rpm",
    ".apk",
    ".aab",
]

EXT_IMPLIES_OS = {
    ".dmg": "macos",
    ".pkg": "macos",
    ".msi": "windows",
    ".exe": "windows",
    ".appimage": "linux",
    ".deb": "linux",
    ".rpm": "linux",
    ".apk": "android",
    ".aab": "android",
}


def normalize_name(name: str) -> str:
    return re.sub(r"[_\s]+", "-", (name or "").lower())


def _escape_re(s: str) -> str:
    return re.escape(s)


def has_any_alias(normalized: str, aliases: list[str]) -> bool:
    for alias in aliases:
        a = alias.lower()
        pattern = rf"(^|[^a-z0-9]){_escape_re(a)}([^a-z0-9]|$)"
        if re.search(pattern, normalized):
            return True
    return False


def ends_with_ext(name: str, ext: str) -> bool:
    return (name or "").lower().endswith((ext or "").lower())


def detect_os_ids(name: str, normalized: str) -> list[str]:
    hit: list[str] = []
    for os in OS_OPTIONS:
        if has_any_alias(normalized, os["aliases"]):
            hit.append(os["id"])
    if not hit:
        lower = (name or "").lower()
        for ext, os_id in EXT_IMPLIES_OS.items():
            if lower.endswith(ext) and os_id not in hit:
                hit.append(os_id)
    return hit


def normalize_rule(rule: dict[str, Any] | None) -> dict[str, list[str]]:
    rule = rule or {}
    return {
        "exts": list(rule.get("exts") or []),
        "osIds": list(rule.get("osIds") or rule.get("os_ids") or []),
        "archIds": list(rule.get("archIds") or rule.get("arch_ids") or []),
        "include": [str(x).strip() for x in (rule.get("include") or []) if str(x).strip()],
        "exclude": [str(x).strip() for x in (rule.get("exclude") or []) if str(x).strip()],
    }


def match_github_asset(asset_name: str, rule: dict[str, Any] | None = None) -> dict[str, Any]:
    name = asset_name or ""
    normalized = normalize_name(name)
    r = normalize_rule(rule)

    for kw in r["exclude"]:
        k = kw.lower()
        if k in normalized or k in name.lower():
            return {"ok": False, "reason": f"排除关键词：{kw}"}

    if r["exts"]:
        if not any(ends_with_ext(name, ext) for ext in r["exts"]):
            return {"ok": False, "reason": "扩展名不匹配"}

    if r["osIds"]:
        detected = detect_os_ids(name, normalized)
        if not any(os_id in detected for os_id in r["osIds"]):
            return {"ok": False, "reason": "系统不匹配"}

    if r["archIds"]:
        groups = [a for a in ARCH_OPTIONS if a["id"] in r["archIds"]]
        if not any(has_any_alias(normalized, g["aliases"]) for g in groups):
            return {"ok": False, "reason": "架构不匹配"}

    for kw in r["include"]:
        k = kw.lower()
        if k not in normalized and k not in name.lower():
            return {"ok": False, "reason": f"缺少关键词：{kw}"}

    return {"ok": True, "reason": "匹配"}


def filter_assets(assets: list[dict[str, Any]], rule: dict[str, Any] | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for asset in assets or []:
        if match_github_asset(asset.get("name", ""), rule)["ok"]:
            matched.append(asset)
        else:
            unmatched.append(asset)
    return matched, unmatched


def describe_rule(rule: dict[str, Any] | None) -> str:
    r = normalize_rule(rule)
    parts: list[str] = []
    if r["exts"]:
        parts.append("扩展名 " + "/".join(r["exts"]))
    if r["osIds"]:
        labels = [o["label"] for o in OS_OPTIONS if o["id"] in r["osIds"]]
        parts.append("系统 " + "/".join(labels))
    if r["archIds"]:
        labels = [a["label"] for a in ARCH_OPTIONS if a["id"] in r["archIds"]]
        parts.append("架构 " + "/".join(labels))
    if r["include"]:
        parts.append("包含 " + "+".join(r["include"]))
    if r["exclude"]:
        parts.append("排除 " + "/".join(r["exclude"]))
    return " · ".join(parts) if parts else "未设置筛选（保留全部附件）"
