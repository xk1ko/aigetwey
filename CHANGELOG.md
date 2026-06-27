# Changelog

All notable changes to **aigetwey** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] — 2026-06-28

### Added
- **Changelog popup** — click version badge in top bar to view full changelog;
  fetches from GitHub and renders markdown inline

### Fixed
- **Windows tray icon** — generates `.ico` from PNG at runtime and loads via
  `System.Drawing.Icon(stream)` instead of PNG→Bitmap→GetHicon (native format,
  correct sizing + transparency)

## [1.5.0] — 2026-06-28

### Added
- **Custom budget windows** — any `Nh` or `Nday` value works (e.g. `3h`, `90day`);
  custom text input next to preset pills in Budget and Key Scope forms
- **Quota/billing fallback** — quota, exhausted, payment, billing, free-tier,
  insufficient, credit errors now trigger fallback to next provider
- **Access-denied fallback** — eligible, denied, not-available, not-supported,
  not-access errors also trigger fallback
- **Usage breakdown pagination** — 8 rows per page with nav + page counter
- **Strategy info button** — toggles explanation panel in combos page
- **Combo chain collapse** — max 5 visible with show-all/show-less toggle
- **ModelPicker select all** — per-group select all/deselect + global select all/clear

### Changed
- **Combo modalities = union** — any model supports image → combo supports image;
  user manages fallback chain (was intersection of all models)
- **Combo form drag** — replaced native drag with dnd-kit (vertical-only, smooth)
- **Provider card rombak** — header/body/footer split; toggle separated from info
  pills; delete in-flow in footer (was absolute); subtitle shows `id/<model>`
- **Budget card alignment** — bar+spending+est pinned to bottom as group; space
  reserved for note+est even when absent
- **RichCard body** — `flex flex-col` so `h-full` children stretch properly across
  all card-based pages
- **Today usage chart** — 15min buckets (was 1h) for finer granularity
- **Usage window pills** — segmented control matching Endpoint design
- **Access key pills** — vertical background pills (bg-bg/bg-accent-soft)
- **'no key' → 'free' badge** — skip '0 keys' when provider is free (was contradictory)
- **Global font cleanup** — `text-[12.5px]`→`text-[13px]` globally, minimum font
  size bumped, dim text colors brightened

### Fixed
- **Per-provider cooldown/retries removed** — replaced with global constants
  `COOLDOWN_BASE_MS=1000`, `MAX_RETRIES=2` (matches 9router approach)
- **est_converse shows remaining** — `(limit - spent) / rate` = tokens/USD left
  (was showing spent or limit)
- **Key scope save refresh** — budgets refetched in `reload()` so spend cap
  changes appear immediately (was only fetched on mount)
- **opencodeApply replaces models** — fresh modelMap, deleted models stay deleted
- **GLM-5.2 vision capability** — marked as vision-capable in provider overrides
- **Key mask shows 7+4 chars** — was 3+4, easier identification
- **RichCard overflow-hidden removed** — Select dropdowns extend beyond card
- **Single data point chart** — shows message instead of empty dot
- **Lamp pulse removed** — red lamp stays solid like green

## [1.4.8] — 2026-06-27

### Added
- **`/v1/embeddings` endpoint** — gateway serves embedding requests with
  provider fallback (same combo routing as chat); Gemini embedding format
  translated to OpenAI-compatible response
- **Copy button for model names** — click-to-copy model id in provider detail
  for quick `provider/model` usage in any app
- **Combo sticky round-robin** — N consecutive requests to the same model before
  rotating; adjustable via +/- counter in combo form
- **Provider card quick delete** — hover trash icon on provider card for
  one-click removal without navigating to detail page
- **Provider bulk select** — select mode toggles multiple providers at once;
  click card to select, bulk delete button in header
- **Provider import/export (JSON)** — export providers as JSON for sharing;
  import merges new providers and adds new keys to existing ones without
  wiping current config

### Changed
- **Combo pricing auto-detected** — removed manual price_in/price_out fields
  from combo form; pricing now resolves from model patterns automatically
- **Key toggle indicator** — disabled keys now show red lamp + red toggle icon
  (was gray), matching provider disabled state styling
- **CLI tools detection status on cards** — detected/not-detected badge shown
  directly on tool cards (no need to click into detail)

### Fixed
- **Windows system tray** — `trayWin.ts` was missing entirely; now implemented
  via PowerShell NotifyIcon (no native binary needed)
- **opencode detection on Windows** — inject `%APPDATA%/npm` into PATH so
  `where opencode` finds npm global installs
- **GLM-5.2 vision capability** — marked as vision-capable in provider
  overrides so image input routes correctly
- **CLI Tools endpoint dropdown** — shows `__auto__` label instead of raw URL
  when endpoint is auto-detected
- **Token saver toggle selected state** — uses accent color for clear visual
  distinction between on/off states

## [1.4.7] — 2026-06-27

### Added
- **Check key before adding** — new Check button tests a raw API key against the
  provider's base URL without saving it to config
- **Bulk add keys** — modal popup accepts multiple keys (format: `name|apiKey` or
  just `apiKey`, one per line)
- **Custom Select component** — replaces native browser `<select>` across the
  dashboard for consistent styling

### Changed
- **Provider detail layout rework** — connection info inline in header, Models &
  Keys stacked vertically full-width (no 2-col grid); Keys card first
- **Round Robin sticky inline** — Sticky counter appears on the same row as the
  toggle; no layout shift when toggling on/off
- **Test connection result** — full-width error bar (same style as fetch models
  failure) instead of small inline badge
- **Edit form full-width** — removed max-width constraint, aligns with cards below
- **Server Console icon** — changed to `receipt_long` (distinct from CLI Tools)
- **Model test icon** — `wifi_tethering` (consistent with key test button)
- **TopBar** — aigetwey logo pill + brand name replace admin text
- **Light mode toggle** — hover animation on the toggle button
- **Save disabled when prefix empty** — prefix is required for routing

## [1.4.6] — 2026-06-27

### Changed
- **Default bind `0.0.0.0`** — VPS/Docker deploys work out of the box without
  manual host config; security warning fires when no api_keys are set

### Fixed
- **Tunnel UX** — spinner during connect, badge labels (Local/Tunnel), security
  warnings for missing API keys or default password, dismiss button on warning
- **Display URLs use `localhost`** — cleaner than raw `127.0.0.1` in CLI output
  and dashboard

### Security
- **Bare model resolution removed** — clients must use combo alias or
  `provider/model` prefix; prevents unintended routing to arbitrary models
- **Remote access blocked when no api_keys** — only loopback allowed without
  keys; remote IPs get 403 with setup instructions

## [1.4.5] — 2026-06-27

### Fixed
- **Dashboard CSS/JS missing after install** — standalone build now copies
  `.next/static` into the standalone directory so assets are served correctly

## [1.4.4] — 2026-06-27

### Fixed
- **Autostart toggle now works** — was using `require()` in ESM project (silent
  fail); switched to dynamic `import()`
- **Fetch models error inline** — "models endpoint returned 404" now shows as a
  red banner below the button instead of replacing the entire page
- **Provider validation message** — says "ID / Prefix is required" instead of
  misleading "name and base URL are required"

### Changed
- **Dashboard standalone build** — Next.js `output: "standalone"` bundles only
  traced deps; eliminates "installing dashboard dependencies" on every update.
  Package size 4→12 MB, but saves 379 MB runtime install + 30-60s wait.

## [1.4.3] — 2026-06-27

### Added
- **Autostart dashboard toggle** — enable/disable run-on-boot from Settings page
- **Interactive chart tooltip** — hover usage chart to see details per data point
- **Security headers** — X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **CORS for /v1** — LLM clients can call from any origin; dashboard blocked

### Fixed
- **Helpful error messages** — budget exceeded shows reset time, key expired shows
  expiry date, rate limit shows max RPM
- **Autostart includes --skip-update** — faster boot, no network hang on startup
- **Port conflict with 9Router** — internal dashboard port changed to 18081 (was
  3000, conflicted with 9Router's Next.js); only reaps own stale processes
- **VPS auth warning** — loud log when binding non-localhost with no api_keys

### Changed
- README: clarified "everything configurable from dashboard", collapsed YAML ref
- Update command uses `--prefer-online` for reliable npm cache bypass

## [1.4.2] — 2026-06-27

### Added
- **Provider Label field** — separate display name from routing prefix.
  Label (optional) shown in dashboard; ID/Prefix used by CLI tools.
  Available in both Add Provider and Edit Connection forms.

### Fixed
- **Headroom stop from dashboard** — externally-started headroom proxy
  (started before aigetwey) can now be stopped from the dashboard. Falls
  back to port-based process detection when no PID file exists.

## [1.4.1] — 2026-06-27

### Fixed
- **Usage data lost on upgrade** — `usage.sqlite` (providers, budgets, request
  history) was not migrated from the old `data/` directory to `~/.aigetwey/`
  when upgrading via `npm install -g`. Dashboard showed empty state. Now the
  database is copied automatically on first run after upgrade.

## [1.4.0] — 2026-06-27

### Added
- **Access Keys page** — dedicated `/keys` page with card grid, per-key scope
  modal (models, rate limit, expiry, budget), and inline search/filter.
- **Provider drag-to-reorder** — reorder provider cards via drag-and-drop
  (@dnd-kit/sortable); priority persists to config.
- **Update modal** — top bar update chip opens a modal with copy command and
  "Copy & Shut down" action for seamless upgrades.
- **Key name deduplication** — adding a key with an existing name is rejected
  with an inline error banner.

### Changed
- **"Gateway Keys" → "Access Keys"** — renamed across nav, top bar, and page.
- **Provider cards** — larger font sizes, more padding, "free" badge renamed to
  "no auth", provider lamp turns red (not grey) when toggled off,
  enabled/disabled label removed from toggle.
- **Key cards** — buttons match budget card style (Edit / Remove, always
  visible); rename merged into the scope modal; active badge is green, expired
  is red.
- **Endpoint card** — full-width, URL label simplified to "Local".
- **Dashboard readability** — 1.06× zoom on main content area for better
  legibility across all pages.
- **README** — updated screenshots (Endpoint, Access Keys, Budgets).

### Fixed
- **ModelPicker crash** — `onSelect` → `onToggle` prop fix in key scope modal.
- **Key reveal layout shift** — copy button reserves space when hidden.
- **Error display** — key page errors shown as dismissible inline banner instead
  of full-page blank.
- **Version chip** — shows "current → latest" instead of "vX available".
- **CLI tools** — removed hardcoded `API_TIMEOUT_MS` from config preview.

## [1.3.9] — 2026-06-26

### Added
- **Persistent data directory** — config, usage database, auth, and session
  secret now live in `~/.aigetwey/` instead of the npm package directory.
  Updating aigetwey with `npm install -g` no longer wipes providers or
  settings. On first run after upgrading, existing `config.yaml` and auth
  data are migrated automatically.
- **Headroom PID survives restarts** — the headroom proxy PID file is now
  stored in `~/.aigetwey/headroom/proxy.pid`, so the dashboard can detect and
  stop a running headroom proxy even after the gateway restarts.

### Fixed
- **`tokens_in` now counts all input** — for Anthropic providers,
  `tokens_in` now includes `cache_read` and `cache_creation` tokens (the
  model processes all of them). Previously only non-cached input was counted.
- **Reasoning token double-count in cost** — `completion_tokens` from both
  Anthropic and OpenAI already includes reasoning/thinking tokens; we were
  charging them twice. Cost now correctly bills non-reasoning output at
  `priceOut` and reasoning at `priceReasoning`.
- **Cache creation cost** — `cache_creation_tokens` are now billed at the
  dedicated `cache_creation` rate (e.g. 1.25× input for Anthropic). Previously
  cache writes were not included in cost at all.
- **Update command copies `@latest`** — the clipboard copy next to the update
  pill now writes `npm install -g aigetwey@latest` instead of a pinned version.
- **Log table row hover** — increased hover background opacity in the Usage
  request log for better visibility.

## [1.3.8] — 2026-06-26

### Changed
- **Update notification** — the top bar update badge is now a prominent pill
  that links to GitHub releases. A copy button next to it puts the exact
  `npm install -g aigetwey@<version>` command on the clipboard.

## [1.3.7] — 2026-06-26

### Added
- **CLI Tools — custom endpoint & API key** — each CLI tool now has a select
  dropdown to pick the gateway endpoint (auto-detected or a saved custom URL)
  and a separate API key override. Custom URLs persist across sessions and can
  be deleted individually via a trash button next to the select.
- **CLI Tools — Anthropic model slots** — instead of a free-text dropdown,
  each slot (opus / sonnet / haiku) shows a chip with the selected model and an
  "Add model" button that opens the model picker modal.

### Fixed
- **Multi-instance session conflict** — running a dev server alongside the
  global install no longer invalidates each other's login. The session cookie
  name is now scoped to the gateway port (`aigetwey_session_<port>`), so both
  instances maintain independent sessions in the same browser.
- **Dev / global data isolation** — `dev.sh` uses `data-dev/` as its data
  directory (`AIGETWEY_DATA_DIR`), preventing SQLite write-lock contention and
  session-secret conflicts when both instances run simultaneously.
- **Headroom toggle** — the "Enable headroom" toggle is disabled while the
  headroom proxy is not running, preventing accidental enable without a proxy.
- **Start proxy button** — shows a spinner and is disabled while the proxy is
  starting; auto-checks status after start.
- **Provider name placeholder** — removed a stale placeholder value from the
  provider name field.

## [1.3.6] — 2026-06-26

### Changed
- Suppress `npm fund` and `npm audit` output during first-run dependency install.

## [1.3.5] — 2026-06-26

### Added
- **`--version` / `-v` flag** — prints the version and exits instead of showing the menu.

## [1.3.4] — 2026-06-26

### Changed
- **Pre-built dashboard shipped in package** — `dashboard/.next/` (production
  build artifacts) is now included in the npm tarball. First-run no longer
  triggers a 1–2 minute silent dashboard build; only a fast `npm install` of
  dashboard dependencies is needed instead.
- **Tray runtime pre-installed via `postinstall`** — `systray2` is now installed
  into `~/.aigetwey/runtime/` immediately after `npm install -g aigetwey`, so
  option 3 (Hide to Tray) is ready on first launch without any extra wait.

## [1.3.3] — 2026-06-26

### Fixed
- **Default admin password** — password now defaults to `123456` (stable across
  restarts) instead of a random hex string generated on every boot. Set
  `AIGETWEY_ADMIN_PASSWORD` to override.
- **Hide to Tray on first run** — option 3 (Hide to Tray) now runs `ensureSetup`
  and pre-installs the tray runtime (`systray2`) in the foreground before
  detaching. Previously the background process built the dashboard and installed
  the tray silently with no output, leaving the tray icon never appearing and the
  gateway unreachable until the build finished.

## [1.3.2] — 2026-06-26

### Fixed
- **Cache & reasoning token accounting** — OpenAI cached tokens
  (`prompt_tokens_details.cached_tokens`) on both the streaming and non-streaming
  paths, plus reasoning tokens on the non-streaming path (OpenAI
  `completion_tokens_details.reasoning_tokens`, Gemini `thoughtsTokenCount`), were
  dropped from the usage log. They are now flattened into the canonical usage so
  cache and reasoning are recorded consistently across streaming and non-streaming
  for every provider. The `tokens_in`/`tokens_out` reading is unchanged.

## [1.3.1] — 2026-06-26

### Added
- **Granular cost calculation** — cost now uses separate per-1M rates for
  non-cached input, cache-read, output, and reasoning tokens instead of a flat
  input/output split. Models with extended thinking (Claude Sonnet 4, o1, Gemini
  thinking) are now tracked accurately.
- **Reasoning token extraction** — extracts `reasoning_tokens` from Anthropic
  (`thinking_tokens`), OpenAI (`completion_tokens_details.reasoning_tokens`), and
  Gemini (`thoughtsTokenCount`); stored in the usage log for future display.

## [1.3.0] — 2026-06-26

### Added
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
