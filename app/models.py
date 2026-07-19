from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SourceType = Literal["github", "article"]


class FilterRule(BaseModel):
    exts: list[str] = Field(default_factory=list)
    os_ids: list[str] = Field(default_factory=list, alias="osIds")
    arch_ids: list[str] = Field(default_factory=list, alias="archIds")
    include: list[str] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class AssetOut(BaseModel):
    name: str
    url: str
    size: Optional[int] = None


class NetdiskOut(BaseModel):
    provider: str
    title: str = ""
    url: str
    code: str = ""


class SourceCreate(BaseModel):
    type: SourceType
    url: str
    name: str = ""
    enabled: bool = True
    filter_rule: Optional[FilterRule] = Field(default=None, alias="filterRule")
    include_prerelease: bool = Field(default=True, alias="includePrerelease")

    model_config = {"populate_by_name": True}


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    url: Optional[str] = None
    filter_rule: Optional[FilterRule] = Field(default=None, alias="filterRule")
    include_prerelease: Optional[bool] = Field(default=None, alias="includePrerelease")

    model_config = {"populate_by_name": True}


class SourceOut(BaseModel):
    id: int
    type: SourceType
    name: str
    url: str
    enabled: bool
    include_prerelease: bool = Field(alias="includePrerelease")
    filter_rule: Optional[FilterRule] = Field(default=None, alias="filterRule")
    status: str
    summary: str
    version: str
    title: str
    assets: list[AssetOut] = Field(default_factory=list)
    unmatched_assets: list[AssetOut] = Field(default_factory=list, alias="unmatchedAssets")
    netdisks: list[NetdiskOut] = Field(default_factory=list)
    last_check: Optional[str] = Field(default=None, alias="lastCheck")
    last_error: str = Field(default="", alias="lastError")
    has_update: bool = Field(default=False, alias="hasUpdate")

    model_config = {"populate_by_name": True, "by_alias": True}


class SettingsOut(BaseModel):
    interval_hours: int = Field(alias="intervalHours")
    bot_token: str = Field(alias="botToken")
    chat_id: str = Field(alias="chatId")
    telegram_configured: bool = Field(alias="telegramConfigured")
    has_token: bool = Field(alias="hasToken")
    has_panel_password: bool = Field(alias="hasPanelPassword")

    model_config = {"populate_by_name": True, "by_alias": True}


class SettingsUpdate(BaseModel):
    interval_hours: Optional[int] = Field(default=None, alias="intervalHours")
    bot_token: Optional[str] = Field(default=None, alias="botToken")
    chat_id: Optional[str] = Field(default=None, alias="chatId")
    panel_password: Optional[str] = Field(default=None, alias="panelPassword")
    clear_panel_password: Optional[bool] = Field(default=None, alias="clearPanelPassword")

    model_config = {"populate_by_name": True}


class LoginRequest(BaseModel):
    password: str = ""


class CheckResult(BaseModel):
    checked: int
    updated: int
    errors: int
    details: list[dict[str, Any]] = Field(default_factory=list)
