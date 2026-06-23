# aigetwey

Personal AI gateway. One local endpoint takes requests from your CLI coding
tools (Claude Code, opencode, Cursor, Cline, Codex), translates between formats,
routes with fallback across providers, and tracks token usage and cost. Ships
with a Haulix-styled dashboard.

- **One endpoint, every format** — clients speak OpenAI (`/v1/chat/completions`)
  or Anthropic (`/v1/messages`); the gateway translates to/from OpenAI,
  Anthropic, or Gemini providers, streaming included.
- **Routing + fallback** — a client alias resolves to a prioritized provider
  chain; on 429/5xx/timeout it rotates keys and falls through to the next.
- **Token savers** — RTK compresses bulky `tool_result` blocks; caveman trims
  output prose; ponytail nudges minimal code. All toggle per-endpoint.
- **Quota + cost** — per-provider token budgets with scheduled-window resets, a
  reset countdown, and SQLite-backed usage/cost tracking.
- **Free + Vertex** — OpenCode Free passthrough (no auth, auto-fetch models) and
  Vertex AI via a GCP service-account JSON.

## Stack

Backend: Fastify 5 + undici + zod + YAML + `node:sqlite` + vitest.
Dashboard: Next.js App Router + Tailwind v4. Ports: gateway `18080`, dashboard
`3000`.

## Quick start

```bash
npm install
cp config.example.yaml config.yaml      # then edit: add providers + a server key
npm install --prefix dashboard           # if you want the dashboard

# run gateway + dashboard together (Ctrl-C stops both)
./run.sh
```

`run.sh` boots the gateway, waits for `/health`, then starts the dashboard
pointed at it and opens the browser. An admin password is generated if
`AIGETWEY_ADMIN_PASSWORD` isn't set (printed on startup). Set it to keep it
stable across runs.

Gateway only:

```bash
npm run dev          # tsx watch (live reload)
# or
npm run build && npm start
```

## Configuration

`config.yaml` is the source of truth and is **hot-reloaded** — edits via the
dashboard (or the API) apply without a restart. See `config.example.yaml` for
every provider shape. The essentials:

```yaml
server:
  host: 127.0.0.1
  port: 18080
  api_keys: [my-key]        # keys clients must present. empty = auth OFF (localhost only)

endpoint:
  rtk: true                 # compress tool_result in the request
  caveman: full             # off | lite | full | ultra — terser output
  ponytail: lite            # off | lite | full | ultra — minimal code

providers:
  - id: anthropic
    format: anthropic
    base_url: https://api.anthropic.com/v1
    api_keys: [sk-ant-xxx]
    quota: { window: weekly, reset_at: monday, timezone: Asia/Jakarta }
  - id: opencode-free
    format: openai
    base_url: https://opencode.ai/zen/v1
    free: true              # no upstream auth
    auto_models: true       # fetch the catalog at runtime
  - id: vertex
    format: gemini
    base_url: https://us-central1-aiplatform.googleapis.com/v1
    service_account: /path/to/sa.json
    quota: { window: monthly, limit_tokens: 300000000 }

models:                     # routing: client alias -> prioritized provider chain
  - alias: claude-sonnet-4-6
    target: [anthropic, opencode-free]   # fallback order
    model: [claude-sonnet-4-6, claude-sonnet-4-5]
    price_in: 3             # USD per 1M tokens (for cost tracking)
    price_out: 15
```

A **combo** is one of these `models` entries: an alias your CLI tool calls,
routed to an ordered provider chain. `strategy: fallback` (default) tries the
chain in order, falling through on 429/5xx/timeout; `strategy: round-robin`
rotates the first provider tried per request to spread load.

## Connecting CLI tools

The dashboard's **CLI Tools** page generates copy-ready env for each tool. In
short, point the tool's base URL + key at the gateway and call a routing alias
as the model name:

```bash
# Claude Code (Anthropic format)
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (OpenAI format)
export OPENAI_BASE_URL=http://127.0.0.1:18080/v1
export OPENAI_API_KEY=my-key
```

The gateway translates formats, so an Anthropic-format client can be served by
an OpenAI or Gemini provider transparently.

**Naming a model** — the `model` field your client sends resolves three ways, in
order: (1) a **combo alias** → its provider chain; (2) **`provider/model`**
(e.g. `anthropic/claude-sonnet-4-6`) → straight to that provider, like 9router's
prefix; (3) a **bare model id** → auto-detected against every provider's catalog,
routed to whoever lists it (multiple → fallback chain). No prefix required.

## Environment

Gateway:
- `AIGETWEY_CONFIG` — config path (default `config.yaml`)
- `AIGETWEY_DATA_DIR` — usage DB dir (default `data/`)
- `AIGETWEY_ADMIN_PASSWORD` — admin password for `/admin/*` and the dashboard
- `AIGETWEY_PORT` — override the listen port (the launcher sets this)

Dashboard (`dashboard/.env.local`, see `dashboard/.env.example`):
- `GATEWAY_URL` — where the gateway is reachable from the dashboard server
- `ADMIN_PASSWORD` — must match the gateway's
- `SESSION_SECRET` — signs the session cookie (`openssl rand -hex 32`)

The admin password and provider keys never reach the browser: the dashboard
proxies `/admin/*` server-side with the Bearer injected, and keys are masked in
every response.

## Development

```bash
npm run typecheck       # tsc, no emit
npm test                # vitest (unit + synthetic E2E)
npm run build           # compile to dist/
```

Tests cover adapters, streaming, fallback, keypool, RTK, inject, quota, usage,
config mutation, and a synthetic end-to-end suite that drives a real Fastify
gateway over HTTP against a faked upstream. Verifying against real CLI tools and
real provider keys is a manual step — use the CLI Tools page.

## Layout

```
src/
  server.ts cli.ts config.ts db.ts
  core/      canonical handler keypool fallback quota state
  adapters/  openai anthropic gemini
  stream/    sse chunk {openai,anthropic,gemini}-stream
  inject/    caveman ponytail
  rtk/       detect filters index
  providers/ free vertex
  upstream/  client
  routes/    health v1 admin
  middleware/ auth
dashboard/   Next.js console (rail + topbar shell, IA per the pages above)
```

Scope is personal/local use. Out of scope (by design): OAuth subscription
providers, cloud sync, container/CDN deploy, i18n.
