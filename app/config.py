from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("APPUPDATE_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "appupdate.db"
DEFAULT_INTERVAL_HOURS = int(os.environ.get("APPUPDATE_INTERVAL_HOURS", "6"))
USER_AGENT = os.environ.get(
    "APPUPDATE_USER_AGENT",
    "AppUpdate/1.0 (+intranet; GitHub release & article tracker)",
)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()

# Optional initial panel password (only applied when DB has none)
# Prefer setting via web UI after first start.
