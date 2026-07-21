from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import db
from app.services.checker import check_all, check_one

router = APIRouter(prefix="/api", tags=["actions"])


class CheckBody(BaseModel):
    source_ids: Optional[list[int]] = Field(default=None, alias="sourceIds")

    model_config = {"populate_by_name": True}


@router.post("/check")
async def check_now(
    source_id: Optional[int] = Query(default=None, alias="sourceId"),
    failed_only: bool = Query(default=False, alias="failedOnly"),
    body: Optional[CheckBody] = None,
) -> dict[str, Any]:
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

    ids = None
    if body and body.source_ids:
        ids = [int(x) for x in body.source_ids]
        if not ids:
            return {"checked": 0, "updated": 0, "errors": 0, "details": []}

    return await check_all(ids=ids, failed_only=failed_only and ids is None, notify=True)
