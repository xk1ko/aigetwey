# Changelog

All notable changes to **aigetwey** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-06-24

### Added
- **Gateway-wide budget** — a single spend budget in USD **or** tokens (pick
  one), with a soft alert (default 80%) and a hard stop that returns `402
  budget exceeded` once the window is spent. Budget spend is derived from the
  usage table (one source of truth, restart-safe), and the dashboard's Quota
  page shows it as an editable card with a converse-unit estimate and a reset
  countdown. Configure via `budget:` in config or `PUT /admin/budget`.
- **Per-provider quota alert** — quotas now carry an optional `alert_at`
  threshold and surface an "alert" badge on the Quota page before they exhaust.

## [1.0.1] — 2026-06-24

### Fixed
- `--help` no longer says the dashboard runs on a separate port — the gateway
  serves the dashboard + API on one URL.
- package.json author uses the GitHub noreply email (keeps the real address
  private), and the version-poll comment reflects the now-published package.

## [1.0.0] — 2026-06-24

First public release. A personal AI gateway that routes, translates, and tracks
requests across Anthropic / OpenAI / Gemini-compatible providers, with a built-in
dashboard.

### Added

#### Gateway
- **Multi-format translation** — one canonical (OpenAI Chat) request shape,
  translated to/from each provider's native wire format (`openai`, `anthropic`,
  `gemini`) on both ingress and egress.
- **Combos** — alias an ordered provider chain (`fallback` or `round-robin`)
  behind a single model name; the alias *is* the model you call.
- **Key pool** — multiple keys per provider with health tracking, cooldown on
  failure, automatic retry/fallback, and per-key enable/disable.
- **Quota tracker** — per-provider token budgets over 5h / daily / weekly /
  monthly windows, exhausted providers skipped in routing.
- **Pricing** — per-model cost resolved via a fallback table
  (model → provider → glob pattern → default), with per-model overrides.
- **Capabilities** — vision / reasoning / context-window / thinking-format
  resolved per model from a built-in table.
- **Thinking normalization** — client thinking intent (model-name suffix like
  `model(high)` or body reasoning params) translated to each provider's native
  thinking format per attempt.
- **Token savers** — RTK (compress tool output), Caveman (terse output style),
  Ponytail (minimal-code bias), and Headroom (external `/v1/compress` context
  compression), each with intensity levels.
- **SSE streaming** with keepalive heartbeat and proxy-buffering disabled.
- **Hot reload** — config changes validate (zod) + persist atomically + rebuild
  the live pool without dropping the process.

#### Dashboard
- Endpoint & Key, Providers, Combos, Usage (with request logs), Quota Tracker,
  CLI Tools, Server Console (live gateway output), and Settings pages.
- **CLI Tools** — detects and auto-configures local tools (Claude Code,
  opencode) by writing their config files, with a copy-ready manual fallback;
  opencode entries carry per-model `modalities` derived from the capabilities
  table.
- **Settings** — structured cards: instance summary, an admin-password change
  card, a per-model Pricing editor, config Backup (export/import), and an
  Advanced raw-YAML editor.
- **Admin password** — changeable at runtime from Settings. The gateway stores it
  as a scrypt hash (`data/auth.json`), seeded from `AIGETWEY_ADMIN_PASSWORD`
  (default `123456`); the dashboard carries the password in an encrypted, signed
  session cookie.
- Floating icon-rail navigation, light/dark themes, toasts.

#### Packaging
- **Single URL** — the gateway reverse-proxies the dashboard, so the console, the
  API (`/v1`, `/messages`), and `/admin` all live on one address
  (`http://127.0.0.1:18080`). Client API traffic stays direct on Fastify; only
  the dashboard is proxied.
- Single-command launcher (`aigetwey`) that brings up gateway + dashboard and
  reaps stale dev servers. Interactive launch menu (Web UI / Terminal / Hide to
  Tray / Exit) on a TTY, plus flags: `-p/--port`, `-n/--no-browser`, `-y/--yes`,
  `-t/--tray`, `-h/--help`.
- **System tray** (macOS/Linux via lazy-installed `systray2`, kept out of the
  tarball; Windows planned): Open Dashboard / Auto-start / Quit, with run-on-OS-
  startup. "Hide to Tray" detaches the stack into the background.
- Installable as a global npm package; first run self-bootstraps (seeds config,
  installs dashboard deps, builds the dashboard).
- Brand: `a»` mark (favicon + sidebar) and an `ai»getwey` wordmark.

[Unreleased]: https://github.com/xk1ko/aigetwey/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/xk1ko/aigetwey/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/xk1ko/aigetwey/releases/tag/v1.0.0
