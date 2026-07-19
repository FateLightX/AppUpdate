# Design QA — 更新追踪 · 方案 5

## Comparison targets
- Source: `/Users/x/Documents/Codex/App/AppUpdate/design-options/5-nezha-rows.html` (selected option 5 mock)
- Implementation: `http://127.0.0.1:5173/`
- Evidence: `qa-ref.png`, `qa-impl.png`, `qa-filter.png`, `qa-settings.png`

## Required fidelity surfaces
- **Fonts/typography:** Inter + Noto Sans SC; 14px body; bold brand; muted 12–13px subcopy — matches mock.
- **Spacing/layout rhythm:** Sticky top bar, 1100px content width, 12px panel radius, row padding ~14×16 — matches mock.
- **Colors/tokens:** `#fafafa` bg, `#0c0a09` text, `#e7e5e4` lines, green/amber status dots, blue action links — matches mock.
- **Image quality/assets:** No raster assets in mock; icons from Lucide for interactive chrome only (add/check/settings). Status dots and progress bars are intentional UI chrome matching the mock language.
- **Copy/content:** Chinese labels and sample tracker rows aligned to mock (Clash Verge Rev, 某资源站更新帖, LocalSend, etc.).

## Findings
No P0 / P1 / P2 mismatches remaining after build.

Accepted deltas (not defects):
- Implementation adds interactive detail panel below the table (not in static mock) to support core flows: copy links, netdisk fields, enable toggle.
- Online pill text includes “TG 已连接” for product requirements.
- Mobile reflow for narrow viewports (mock was desktop-only).

## Interactions verified
- Filter chips (全部 / 有更新 / GitHub / 文章)
- 立即检查 loading toast
- 添加 modal form
- 设置 modal (interval + Telegram fields)
- Row select → detail; copy actions; enable switch

## final result: passed
