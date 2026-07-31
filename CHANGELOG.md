# Changelog

## 0.2.0 — 2026-07-31

- Settings → Maintenance: **Rebuild endpoints from history** — drops current
  endpoint definitions and re-collates them from every stored entry. Use
  after an upgrade (e.g. history captured under 0.1.0's broken collation)
  or import.

## 0.1.1 — 2026-07-31

- Fix: IndexedDB `get()` on a missing key resolved to a truthy internal
  holder instead of `undefined`, crashing endpoint collation on every entry
  — the API tab never populated. Also hardened missing-entry/profile reads.

## 0.1.0 — 2026-07-31

Initial release.

- MAIN-world fetch/XHR capture shim with pre-activation buffering
- Per-site profiles: URL patterns, body cap, entry cap, pause/resume
- Streams view: live filterable log, full request/response detail,
  syntax-colored collapsible JSON, per-item copy buttons, copy-as-cURL
- API workbench: automatic endpoint collation (path templating, query keys,
  status distribution, latency, inferred req/res JSON schemas), try-it form
  executing in page context, replay from history
- On-page shadow-DOM overlay ticker (Ctrl+Shift+X)
- Export/import: lossless `.xray.json` (redacted by default) + OpenAPI 3.1
- Catppuccin Latte/Mocha theming, system-aware with manual override
