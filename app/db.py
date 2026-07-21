from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from app.config import DB_PATH, DEFAULT_INTERVAL_HOURS


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              interval_hours INTEGER NOT NULL,
              bot_token TEXT NOT NULL DEFAULT '',
              chat_id TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS sources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT NOT NULL,
              name TEXT NOT NULL,
              url TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              include_prerelease INTEGER NOT NULL DEFAULT 1,
              filter_rule TEXT NOT NULL DEFAULT '{}',
              status TEXT NOT NULL DEFAULT 'ok',
              summary TEXT NOT NULL DEFAULT '',
              version TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL DEFAULT '',
              assets_json TEXT NOT NULL DEFAULT '[]',
              unmatched_json TEXT NOT NULL DEFAULT '[]',
              netdisks_json TEXT NOT NULL DEFAULT '[]',
              fingerprint TEXT NOT NULL DEFAULT '',
              last_check TEXT,
              last_error TEXT NOT NULL DEFAULT '',
              has_update INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        # migrations for existing DBs
        cols = {r[1] for r in conn.execute("PRAGMA table_info(settings)").fetchall()}
        if "panel_password_hash" not in cols:
            conn.execute(
                "ALTER TABLE settings ADD COLUMN panel_password_hash TEXT NOT NULL DEFAULT ''"
            )
        if "telegram_detail" not in cols:
            conn.execute(
                "ALTER TABLE settings ADD COLUMN telegram_detail TEXT NOT NULL DEFAULT 'compact'"
            )

        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )

        row = conn.execute("SELECT id FROM settings WHERE id = 1").fetchone()
        if not row:
            conn.execute(
                "INSERT INTO settings (id, interval_hours, bot_token, chat_id, panel_password_hash) VALUES (1, ?, '', '', '')",
                (DEFAULT_INTERVAL_HOURS,),
            )

        # optional bootstrap password from env (only when empty)
        import os
        bootstrap = os.environ.get("APPUPDATE_PANEL_PASSWORD", "").strip()
        if bootstrap:
            row2 = conn.execute(
                "SELECT panel_password_hash FROM settings WHERE id = 1"
            ).fetchone()
            if row2 is not None and not (row2["panel_password_hash"] or "").strip():
                from app.auth import hash_password

                conn.execute(
                    "UPDATE settings SET panel_password_hash = ? WHERE id = 1",
                    (hash_password(bootstrap),),
                )


def _loads(text: str, default: Any) -> Any:
    try:
        return json.loads(text or "")
    except Exception:
        return default


def row_to_source(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "type": row["type"],
        "name": row["name"],
        "url": row["url"],
        "enabled": bool(row["enabled"]),
        "includePrerelease": bool(row["include_prerelease"]),
        "filterRule": _loads(row["filter_rule"], {}),
        "status": row["status"],
        "summary": row["summary"],
        "version": row["version"],
        "title": row["title"],
        "assets": _loads(row["assets_json"], []),
        "unmatchedAssets": _loads(row["unmatched_json"], []),
        "netdisks": _loads(row["netdisks_json"], []),
        "fingerprint": row["fingerprint"],
        "lastCheck": row["last_check"],
        "lastError": row["last_error"],
        "hasUpdate": bool(row["has_update"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_settings() -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        keys = row.keys()
        panel_hash = row["panel_password_hash"] if "panel_password_hash" in keys else ""
        detail = "compact"
        if "telegram_detail" in keys:
            raw = (row["telegram_detail"] or "").strip().lower()
            detail = "full" if raw == "full" else "compact"
        return {
            "intervalHours": row["interval_hours"],
            "botToken": row["bot_token"] or "",
            "chatId": row["chat_id"] or "",
            "telegramConfigured": bool((row["bot_token"] or "").strip() and (row["chat_id"] or "").strip()),
            "hasToken": bool((row["bot_token"] or "").strip()),
            "panelPasswordHash": panel_hash or "",
            "hasPanelPassword": bool((panel_hash or "").strip()),
            "telegramDetail": detail,
        }


def update_settings(
    *,
    interval_hours: Optional[int] = None,
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None,
    panel_password_hash: Optional[str] = None,
    telegram_detail: Optional[str] = None,
) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        keys = row.keys()
        new_interval = row["interval_hours"] if interval_hours is None else max(1, int(interval_hours))
        new_token = row["bot_token"] if bot_token is None else bot_token
        new_chat = row["chat_id"] if chat_id is None else chat_id
        if panel_password_hash is None:
            new_hash = row["panel_password_hash"] if "panel_password_hash" in keys else ""
        else:
            new_hash = panel_password_hash
        if telegram_detail is None:
            if "telegram_detail" in keys:
                new_detail = row["telegram_detail"] or "compact"
            else:
                new_detail = "compact"
        else:
            new_detail = "full" if str(telegram_detail).strip().lower() == "full" else "compact"
        # ensure column exists for older DBs that skipped init path
        if "telegram_detail" not in keys:
            conn.execute(
                "ALTER TABLE settings ADD COLUMN telegram_detail TEXT NOT NULL DEFAULT 'compact'"
            )
        conn.execute(
            "UPDATE settings SET interval_hours = ?, bot_token = ?, chat_id = ?, panel_password_hash = ?, telegram_detail = ? WHERE id = 1",
            (new_interval, new_token, new_chat, new_hash or "", new_detail),
        )
    return get_settings()


def create_session(token: str, expires_at: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sessions (token, expires_at, created_at) VALUES (?, ?, ?)",
            (token, expires_at, utc_now_iso()),
        )


def session_valid(token: str, now_iso: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT expires_at FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return False
        if (row["expires_at"] or "") < now_iso:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return False
        return True


def delete_session(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def delete_all_sessions() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions")


def list_sources() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM sources ORDER BY id DESC").fetchall()
        return [row_to_source(r) for r in rows]


def get_source(source_id: int) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
        return row_to_source(row) if row else None


def create_source(data: dict[str, Any]) -> dict[str, Any]:
    now = utc_now_iso()
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO sources (
              type, name, url, enabled, include_prerelease, filter_rule,
              status, summary, version, title, assets_json, unmatched_json,
              netdisks_json, fingerprint, last_check, last_error, has_update,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'ok', '', '', '', '[]', '[]', '[]', '', NULL, '', 0, ?, ?)
            """,
            (
                data["type"],
                data["name"],
                data["url"],
                1 if data.get("enabled", True) else 0,
                1 if data.get("include_prerelease", True) else 0,
                json.dumps(data.get("filter_rule") or {}, ensure_ascii=False),
                now,
                now,
            ),
        )
        source_id = int(cur.lastrowid)
    return get_source(source_id)  # type: ignore[return-value]


def update_source(source_id: int, data: dict[str, Any]) -> Optional[dict[str, Any]]:
    current = get_source(source_id)
    if not current:
        return None
    fields: dict[str, Any] = {}
    if "name" in data and data["name"] is not None:
        fields["name"] = data["name"]
    if "url" in data and data["url"] is not None:
        fields["url"] = data["url"]
    if "enabled" in data and data["enabled"] is not None:
        fields["enabled"] = 1 if data["enabled"] else 0
    if "include_prerelease" in data and data["include_prerelease"] is not None:
        fields["include_prerelease"] = 1 if data["include_prerelease"] else 0
    if "filter_rule" in data and data["filter_rule"] is not None:
        fields["filter_rule"] = json.dumps(data["filter_rule"], ensure_ascii=False)

    if not fields:
        return current

    fields["updated_at"] = utc_now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [source_id]
    with connect() as conn:
        conn.execute(f"UPDATE sources SET {cols} WHERE id = ?", vals)
    return get_source(source_id)


def delete_source(source_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        return cur.rowcount > 0


def save_check_result(source_id: int, result: dict[str, Any]) -> Optional[dict[str, Any]]:
    now = utc_now_iso()
    with connect() as conn:
        conn.execute(
            """
            UPDATE sources SET
              status = ?,
              summary = ?,
              version = ?,
              title = ?,
              assets_json = ?,
              unmatched_json = ?,
              netdisks_json = ?,
              fingerprint = ?,
              last_check = ?,
              last_error = ?,
              has_update = ?,
              updated_at = ?
            WHERE id = ?
            """,
            (
                result.get("status", "ok"),
                result.get("summary", ""),
                result.get("version", ""),
                result.get("title", ""),
                json.dumps(result.get("assets") or [], ensure_ascii=False),
                json.dumps(result.get("unmatched_assets") or [], ensure_ascii=False),
                json.dumps(result.get("netdisks") or [], ensure_ascii=False),
                result.get("fingerprint", ""),
                now,
                result.get("last_error", ""),
                1 if result.get("has_update") else 0,
                now,
                source_id,
            ),
        )
    return get_source(source_id)


def clear_update_flag(source_id: int) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE sources SET has_update = 0, status = CASE WHEN enabled = 0 THEN 'off' ELSE 'ok' END, updated_at = ? WHERE id = ?",
            (utc_now_iso(), source_id),
        )
