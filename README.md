# Chrome X-Ray

A self-defining API dev tool. Activate it on a site and it watches every fetch/XHR call, turns the live traffic into streams you can read, and collates those streams into an interactive API workbench — endpoints discovered, templated, schema-inferred, testable. The interface builds itself from what the app actually does.

## What it does

- **Streams** — every outgoing fetch/XHR captured live: request/response headers, status, timing, pretty-printed syntax-colored JSON bodies, errors. Filter by method, status class, or free text across URLs, headers, and payloads. One-click copy on everything — single headers, full header blocks, bodies, URLs, copy-as-cURL.
- **API workbench** — traffic collates into templated endpoints (`/users/8231` → `/users/{userId}`), grouped by host. Each endpoint carries observed query keys, status distribution, average latency, and JSON schemas inferred from real payloads. From there:
  - **Try it** — modern-postman form: arbitrary method/URL/headers/body, sent from the active tab's page context so cookies and origin apply.
  - **Replay** — load any real history item into the form and re-fire it.
- **Overlay** — shadow-DOM live ticker on the page itself (`Ctrl+Shift+X`), for watching calls without leaving the app.
- **Profiles** — capture scoped by URL patterns. One profile per app/environment, each with its own history, endpoints, caps, and settings.
- **Export/import** — lossless `.xray.json` to move a profile's definitions (and redacted examples) to another browser with the extension; one-way OpenAPI 3.1 export for everything else.

## Capture model

A MAIN-world shim wraps `window.fetch` and `XMLHttpRequest` at `document_start`. Silent — no debugger banner, no DevTools conflict. The shim stays dormant until a profile matches the page; early calls buffer until the activation decision arrives.

Known limits of this approach: no `set-cookie`/forbidden headers, no service-worker-originated requests, no wire-level detail. That's the trade for zero friction.

## Privacy

Everything stays in the browser — IndexedDB, extension-private. No network calls of its own, no analytics, nothing leaves the machine. Captured auth headers are stored raw (replay needs them) but redacted on export by default (per-profile setting).

## Install

1. Clone this repo (or unzip a release)
2. `chrome://extensions` → Developer Mode → **Load unpacked** → select the directory

## Usage

1. Open the site you care about
2. Click the x-ray icon → **Activate for this site** (creates a profile scoped to the origin)
3. Use the app. Open the side panel: **Streams** fills live, **API** assembles itself
4. In **API**, open an endpoint → *Try it* with arbitrary data, or load a history call into the form and replay
5. **Export** to carry the definitions elsewhere

## Keyboard

`Ctrl+Shift+X` (`Cmd+Shift+X` on Mac) — toggle the on-page overlay.

## Stack

Vanilla JS, ES modules, no build step, no frameworks. Catppuccin (Latte/Mocha) theming, system-aware with manual override. MV3.

## License

MIT
