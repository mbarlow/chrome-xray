# Changelog

## 0.4.0 — 2026-07-31

- Passive spec detection: captured responses that are OpenAPI/Swagger docs
  get a `spec` chip in Streams and a one-click **Import as API spec** button
  in the entry detail.
- Try-it form: dedicated **query params** editor (seeded from the example
  URL + the endpoint's known keys; URL field is path-only), method-aware
  body hints (GET/HEAD note "no body — use query params"), and JSON body
  skeleton pre-seeded from the spec/observed schema when no real example
  exists. GET/HEAD sends omit the body.
- Inferred/spec schemas render collapsed by default — toggle to expand.


## 0.3.0 — 2026-07-31

- API → **Spec**: discover a served OpenAPI/Swagger definition (auto-probe
  common paths on known hosts, or an explicit URL) and seed the workbench
  from it. OpenAPI 3.x + Swagger 2.0 (JSON), $ref resolution, cookies sent
  for auth-gated specs. Spec endpoints are tagged `spec`; live traffic
  merges into them as `spec+observed`.
- Endpoint identity is now param-name-insensitive and NUL-separated —
  **run Settings → Rebuild endpoints from history after upgrading** so
  existing endpoints pick up the new ids.
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
