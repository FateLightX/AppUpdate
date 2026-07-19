from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.services.checker import check_all, check_one

router = APIRouter(prefix="/api", tags=["actions"])


@router.post("/check")
async def check_now(source_id: Optional[int] = Query(default=None, alias="sourceId")) -> dict[str, Any]:
    if source_id is not None:
        src = db.get_source(source_id)
        if not src:
            raise HTTPException(404, "来源不存在")
        detail = await check_one(src, notify=True)
        return {
            "checked": 1,
            "updated": 1 if detail.get("updated") else 0,
            "errors": 0 if detail.get("ok") else 1,
            "details": [detail],
        }
    return await check_all(notify=True)
