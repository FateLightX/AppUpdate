from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException

from app import auth
from app.models import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
def auth_status(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    required = auth.is_password_required()
    token = auth.extract_bearer(authorization)
    authenticated = (not required) or auth.validate_session(token)
    return {
        "required": required,
        "authenticated": authenticated,
    }


@router.post("/login")
def login(body: LoginRequest) -> dict[str, Any]:
    if not auth.is_password_required():
        return {"token": "", "required": False, "message": "未启用面板密码"}
    from app import db

    stored = db.get_settings().get("panelPasswordHash") or ""
    if not auth.verify_password(body.password or "", stored):
        raise HTTPException(401, "密码错误")
    token = auth.create_session()
    return {"token": token, "required": True, "message": "登录成功"}


@router.post("/logout")
def logout(authorization: Optional[str] = Header(default=None)) -> dict[str, str]:
    token = auth.extract_bearer(authorization)
    auth.revoke_session(token)
    return {"message": "已退出"}
