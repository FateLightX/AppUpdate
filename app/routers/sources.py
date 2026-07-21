from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app import db
from app.models import SourceCreate, SourceUpdate
from app.services import article_svc, github_svc, netdisk_svc
from app.services.match import ARCH_OPTIONS, EXT_OPTIONS, OS_OPTIONS, describe_rule, normalize_rule

router = APIRouter(prefix="/api/sources", tags=["sources"])


def _public(source: dict[str, Any]) -> dict[str, Any]:
    data = {k: v for k, v in source.items() if k not in {"fingerprint", "createdAt", "updatedAt"}}
    rule = source.get("filterRule") or {}
    if source.get("type") == "netdisk":
        data["ruleText"] = netdisk_svc.describe_netdisk_rule(rule)
        data["shareCode"] = str(rule.get("code") or "")
    else:
        data["ruleText"] = describe_rule(rule)
        data["shareCode"] = ""
    if not source.get("enabled"):
        data["status"] = "off"
    return data


@router.get("/meta/filters")
def filter_meta() -> dict[str, Any]:
    return {
        "osOptions": [{"id": o["id"], "label": o["label"]} for o in OS_OPTIONS],
        "archOptions": [{"id": a["id"], "label": a["label"]} for a in ARCH_OPTIONS],
        "extOptions": EXT_OPTIONS,
    }


@router.get("")
def list_all() -> list[dict[str, Any]]:
    return [_public(s) for s in db.list_sources()]


@router.get("/{source_id}")
def get_one(source_id: int) -> dict[str, Any]:
    src = db.get_source(source_id)
    if not src:
        raise HTTPException(404, "来源不存在")
    return _public(src)


@router.post("")
def create(body: SourceCreate) -> dict[str, Any]:
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "请填写地址")

    name = (body.name or "").strip()
    filter_rule = None
    include_prerelease = True

    if body.type == "github":
        try:
            github_svc.parse_repo(url)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if not name:
            name = github_svc.default_name(url)
        filter_rule = normalize_rule(body.filter_rule.model_dump(by_alias=True) if body.filter_rule else {})
        include_prerelease = body.include_prerelease
    elif body.type == "netdisk":
        if not url.startswith("http://") and not url.startswith("https://"):
            raise HTTPException(400, "网盘请填写完整 http(s) 分享链接")
        if not netdisk_svc.is_netdisk_url(url):
            raise HTTPException(400, "暂不支持该网盘，目前支持百度/阿里/夸克/123/天翼/蓝奏")
        if not name:
            name = netdisk_svc.default_name(url)
        code = (body.share_code or "").strip() or netdisk_svc.extract_code(url)
        filter_rule = {"code": code}
        include_prerelease = True
    else:
        if not url.startswith("http://") and not url.startswith("https://"):
            raise HTTPException(400, "文章请填写完整 http(s) 链接")
        if not name:
            name = article_svc.default_name(url)
        filter_rule = {}
        include_prerelease = True

    created = db.create_source(
        {
            "type": body.type,
            "name": name,
            "url": url,
            "enabled": body.enabled,
            "include_prerelease": include_prerelease,
            "filter_rule": filter_rule,
        }
    )
    return _public(created)


@router.patch("/{source_id}")
def update(source_id: int, body: SourceUpdate) -> dict[str, Any]:
    src = db.get_source(source_id)
    if not src:
        raise HTTPException(404, "来源不存在")

    payload: dict[str, Any] = {}
    data = body.model_dump(by_alias=False, exclude_unset=True)
    if "name" in data:
        payload["name"] = (data["name"] or "").strip() or src["name"]
    if "url" in data and data["url"] is not None:
        url = data["url"].strip()
        if src["type"] == "github":
            try:
                github_svc.parse_repo(url)
            except ValueError as e:
                raise HTTPException(400, str(e)) from e
        elif src["type"] == "netdisk":
            if not url.startswith("http://") and not url.startswith("https://"):
                raise HTTPException(400, "网盘请填写完整 http(s) 分享链接")
            if not netdisk_svc.is_netdisk_url(url):
                raise HTTPException(400, "暂不支持该网盘，目前支持百度/阿里/夸克/123/天翼/蓝奏")
        payload["url"] = url
    if "enabled" in data:
        payload["enabled"] = data["enabled"]
    if "include_prerelease" in data:
        payload["include_prerelease"] = data["include_prerelease"]
    if src["type"] == "netdisk" and ("share_code" in data or "url" in payload):
        current_rule = src.get("filterRule") or {}
        code = current_rule.get("code") or ""
        if "share_code" in data and data["share_code"] is not None:
            code = str(data["share_code"] or "").strip()
        elif "url" in payload:
            code = netdisk_svc.extract_code(payload["url"], str(code))
        payload["filter_rule"] = {"code": code}
    elif "filter_rule" in data and data["filter_rule"] is not None:
        payload["filter_rule"] = normalize_rule(
            body.filter_rule.model_dump(by_alias=True) if body.filter_rule else {}
        )

    updated = db.update_source(source_id, payload)
    return _public(updated)  # type: ignore[arg-type]


@router.delete("/{source_id}")
def remove(source_id: int) -> dict[str, bool]:
    if not db.delete_source(source_id):
        raise HTTPException(404, "来源不存在")
    return {"ok": True}


@router.post("/{source_id}/ack")
def ack_update(source_id: int) -> dict[str, Any]:
    src = db.get_source(source_id)
    if not src:
        raise HTTPException(404, "来源不存在")
    db.clear_update_flag(source_id)
    return _public(db.get_source(source_id))  # type: ignore[arg-type]
