# Changelog

All notable changes to **aigetwey** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — Unreleased

### Added
- **Auto-synced pricing** — `npm run sync-pricing` regenerates
  `src/providers/pricing.generated.ts` from models.dev (first-party vendors only,
  no aggregator margin). It's a fallback under your config/dashboard price
  overrides and above the hand-curated table, so vendor prices stay fresh while
  custom-model prices and your overrides are untouched.
- **Per-key expiry** — set an expiry date on a gateway key; `/v1/*` calls with an
  expired key return `403 key expired`. Editable on the Endpoint page next to the
  per-key model allowlist and rate limit. Keys with no expiry never expire.

### Changed
- **Budgets page → Overall + Keys** — the Budgets page now separates Overall caps
  (global/provider/model) from a Keys section that lists every gateway key with its
  spend; capped keys show a bar, reset countdown, and expiry, uncapped keys show
  spend + "no limit". A key's spend cap and expiry are now set in one place — the
  key settings on the Endpoint page — alongside its model allowlist and rate limit.
- **Recurring budgets** — each budget window (`5h`/`24h`/`7day`/`30day`) now
  resets on a cycle anchored to when the budget was created, not a shared epoch
  grid. A per-key budget shared with another device becomes a self-resetting
  allowance; the reset countdown reflects that key's own cycle. Budgets in an
  existing `config.yaml` (no stored anchor) keep the previous epoch-grid reset
  until next edited.

## [1.2.0] — 2026-06-25

### Added
- **Scoped budgets** — budgets are now multi-scope: cap spend **globally**, per
  **provider**, per **model**, or per **API key**. Each carries its own unit
  (USD or tokens), window, soft alert, and a hard `402 budget exceeded` stop;
  spend is still derived from the usage table (restart-safe). The Budget Tracker
  page shows them as a card grid with an inline Add/Edit panel and a searchable
  scope picker. Configure via `budgets:` or `PUT /admin/budgets`. Replaces the
  single gateway-wide budget.
- **Per-API-key budgets** — cap one gateway key's spend. The matched caller key
  fingerprint is recorded on each usage row; `GET /admin/keys` lists keys for
  the picker.
- **Budget note** — an optional label on a budget to say what it's for.
- **Headroom re-check** — a "Check" button to re-probe the Headroom proxy.
- **Usage timeframes** — the Usage window adds **Today** (since local midnight)
  and **60D** alongside 24h / 7D / 30D.
- **Request log filters** — the request log is collapsible and gains Provider +
  Start/End-date filters with a Clear button.

### Changed
- **Budget Tracker** — the Quota page is renamed Budget Tracker; the budget
  "Alert at" threshold is a slider with a typeable %, and the per-provider token
  quota grid (superseded by per-provider budgets) only shows when one is set.
- **Providers** — enable/disable a provider directly from the list card; a
  disabled provider fades, reads red, and its models drop out of the combo,
  CLI-tool, and budget pickers.
- **CLI tools** — the setup list is trimmed to Claude Code + opencode.
- **Providers + OpenAI only** — the project is scoped to Anthropic- and
  OpenAI-compatible providers; Gemini is no longer advertised.
- **Next 16** — adopt the `proxy` file convention (was `middleware`).

### Fixed
- **Streaming usage** — openai-format streaming upstreams now report token
  usage (`stream_options.include_usage`); previously every streamed call through
  an openai-compatible provider logged 0 tokens in/out.
- **Session persistence** — the dashboard session secret is persisted to the
  data dir, so a gateway restart no longer invalidates the cookie and forces a
  re-login.
- Favicon (`icon.svg`) is served publicly past the auth gate.
- Editing a budget preserves its alert threshold.
- The launcher waits for the dashboard to be ready, not just the proxy port.

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
requests across Anthropic and OpenAI-compatible providers, with a built-in
dashboard.

### Added

#### Gateway
- **Multi-format translation** — one canonical (OpenAI Chat) request shape,
  translated to/from each provider's native wire format (`openai`, `anthropic`)
  on both ingress and egress.
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
