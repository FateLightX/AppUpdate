from __future__ import annotations

import unittest

from app.services.telegram_notify import format_update_message


class FormatGitHubUpdateMessageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = {
            "name": "owner/project",
            "type": "github",
            "url": "https://github.com/owner/project",
        }
        self.result = {
            "version": "v1.2.3",
            "assets": [
                {
                    "name": "project-v1.2.3-macos-arm64.dmg",
                    "url": (
                        "https://github.com/owner/project/releases/download/"
                        "v1.2.3/project-v1.2.3-macos-arm64.dmg"
                    ),
                }
            ],
        }

    def test_compact_message_includes_download_url(self) -> None:
        message = format_update_message(self.source, self.result, detail="compact")

        self.assertIn("project-v1.2.3-macos-arm64.dmg", message)
        self.assertIn(self.result["assets"][0]["url"], message)

    def test_full_message_includes_download_url(self) -> None:
        message = format_update_message(self.source, self.result, detail="full")

        self.assertIn(self.result["assets"][0]["url"], message)


if __name__ == "__main__":
    unittest.main()
