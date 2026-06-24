# Changelog

All notable changes to **aigetwey** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Single-command launcher (`aigetwey`) that brings up gateway + dashboard and
  reaps stale dev servers. Interactive launch menu (Web UI / Terminal / Exit)
  on a TTY, plus flags: `-p/--port`, `-n/--no-browser`, `-y/--yes`, `-h/--help`.
- Installable as a global npm package; first run self-bootstraps (seeds config,
  installs dashboard deps, builds the dashboard).
- Brand: `a»` mark (favicon + sidebar) and an `ai»getwey` wordmark.

[Unreleased]: https://github.com/xk1ko/aigetwey/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/xk1ko/aigetwey/releases/tag/v1.0.0
