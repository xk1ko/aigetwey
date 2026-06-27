<p align="center">
  <img src="./assets/wordmark.svg" width="420" alt="aigetwey">
</p>

<p align="center">
  <strong>Personal AI gateway for CLI coding tools</strong><br>
  One endpoint · format translation · fallback routing · token saving · spend control
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aigetwey"><img src="https://img.shields.io/npm/v/aigetwey.svg" alt="npm"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node ≥22">
</p>

---

Point Claude Code, opencode, Cursor, Cline, or Codex at `localhost:18080` and get:

- **Format translation** — clients speak OpenAI or Anthropic; the gateway translates on the fly, streaming included
- **Fallback routing** — one model alias resolves to a priority chain of providers; on 429/5xx/timeout it rotates keys and falls through
- **Token savers** — RTK compresses `tool_result`, caveman trims prose, ponytail nudges minimal code, headroom compresses context — all toggleable per-endpoint
- **Access keys** — hand a gateway key to anyone; set model allowlist, rate limit, spend cap, and expiry per key
- **Budgets** — rolling spend caps (global/provider/model/key) with live countdown, SQLite cost tracking per token type
- **Dashboard** — providers, combos, usage, budgets, CLI tools, live console, settings, drag-to-reorder

```bash
npm install -g aigetwey && aigetwey
```

First run bootstraps everything. Subsequent runs start instantly.

<p align="center">
  <img src="./assets/screenshot-endpoint.png" width="860" alt="Endpoint">
</p>
<p align="center">
  <img src="./assets/screenshot-accesskey.png" width="860" alt="Access Keys">
</p>
<p align="center">
  <img src="./assets/screenshot-budgets.png" width="860" alt="Budgets">
</p>

**Language:** [English](#getting-started) · [Bahasa Indonesia](#memulai)

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## Getting started

### Quick start

```bash
npm install -g aigetwey
aigetwey
```

The CLI seeds `config.yaml`, builds the dashboard, opens your browser. One URL serves everything — dashboard, API, and admin: `http://localhost:18080`.

A terminal menu offers: **Web UI** / **Terminal** (logs) / **Hide to Tray** (macOS + Linux) / **Exit**.
Flags: `-p/--port`, `-n/--no-browser`, `-y/--yes`, `-t/--tray`.

### From source

```bash
git clone https://github.com/xk1ko/aigetwey.git
cd aigetwey && npm install
cp config.example.yaml config.yaml   # add providers + a server key
npm install --prefix dashboard
./run.sh                              # Ctrl-C stops both
```

### Connect your tools

```bash
# Claude Code (Anthropic format)
export ANTHROPIC_BASE_URL=http://localhost:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (OpenAI format)
export OPENAI_BASE_URL=http://localhost:18080/v1
export OPENAI_API_KEY=my-key
```

The dashboard's **CLI Tools** page detects installed tools and writes configs for you.

**Model resolution** (in order): combo alias → `provider/model`.

---

## Configuration

**Everything is configurable from the dashboard** — providers, combos, budgets, token savers, access keys, and settings. No need to edit files manually.

Under the hood, `config.yaml` is the source of truth and **hot-reloads** — any change made in the dashboard writes to this file instantly. You can also edit it by hand if you prefer; changes apply without restart.

<details>
<summary><strong>config.yaml reference (click to expand)</strong></summary>

```yaml
server:
  host: 0.0.0.0
  port: 18080
  api_keys: [my-key]        # empty = auth OFF (localhost only)

endpoint:
  rtk: true                 # compress tool_result blocks
  caveman: full             # off | lite | full | ultra
  ponytail: lite            # off | lite | full | ultra

providers:
  - id: anthropic
    format: anthropic
    base_url: https://api.anthropic.com/v1
    api_keys: [sk-ant-xxx]
  - id: opencode-free
    format: openai
    base_url: https://opencode.ai/zen/v1
    free: true
    auto_models: true

models:
  - alias: claude-sonnet-4-6
    target: [anthropic, opencode-free]   # fallback order
    model: [claude-sonnet-4-6, claude-sonnet-4-5]
    price_in: 3             # USD per 1M tokens
    price_out: 15

budgets:
  - scope: { type: global }
    unit: usd
    limit: 50
    window: 30day
```

</details>

A **combo** is a `models` entry — an alias routed to a provider chain. Strategies: `fallback` (default, sequential) or `round-robin` (spread load).

---

## Token savers

| Saver | What it does | Source | Install |
|-------|-------------|--------|---------|
| **RTK** | Compresses bulky `tool_result` blocks (git/grep/ls) | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | built-in |
| **Caveman** | Terse system prompt — cuts output prose | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | built-in |
| **Ponytail** | Nudges minimal code (YAGNI, deletion) | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | built-in |
| **Headroom** | Pipes context through `/v1/compress` | [chopratejas/headroom](https://github.com/chopratejas/headroom) | **external** |

Headroom is the only external dependency — install from [chopratejas/headroom](https://github.com/chopratejas/headroom) (Python ≥ 3.10), run `headroom proxy`. Without it the toggle stays off; everything else works.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AIGETWEY_CONFIG` | Config file path |
| `AIGETWEY_DATA_DIR` | Usage DB directory |
| `AIGETWEY_ADMIN_PASSWORD` | Admin + dashboard auth |
| `AIGETWEY_PORT` | Listen port |

Dashboard (`dashboard/.env.local`): `GATEWAY_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`.

Admin password and provider keys never reach the browser — the dashboard proxies `/admin/*` server-side.

---

## Development

```bash
npm run typecheck       # tsc, no emit
npm test                # vitest (unit + synthetic E2E)
npm run build           # compile to dist/
```

---

## Memulai

### Mulai cepat

```bash
npm install -g aigetwey
aigetwey
```

Run pertama bootstrap otomatis — buat `config.yaml`, build dashboard, buka browser. Satu URL untuk semuanya: `http://localhost:18080`.

### Hubungkan tool

```bash
# Claude Code (format Anthropic)
export ANTHROPIC_BASE_URL=http://localhost:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (format OpenAI)
export OPENAI_BASE_URL=http://localhost:18080/v1
export OPENAI_API_KEY=my-key
```

Halaman **CLI Tools** di dashboard mendeteksi tool dan menulis config otomatis.

### Fitur utama

- **Satu endpoint, semua format** — translate OpenAI ↔ Anthropic otomatis, termasuk streaming
- **Routing + fallback** — alias model → rantai provider berprioritas; rotasi key saat 429/5xx/timeout
- **Penghemat token** — RTK, Caveman, Ponytail (built-in) + Headroom (eksternal)
- **Access keys** — bagi key ke teman dengan allowlist model, rate limit, batas spend, dan kedaluwarsa
- **Budget** — spend cap rolling (5h/24h/7day/30day) dengan countdown dan tracking per jenis token
- **Dashboard** — providers, combos, usage, budgets, CLI tools, console live, settings, drag-to-reorder

### Penghemat token

RTK, Caveman, Ponytail = **built-in**. Hanya Headroom yang **eksternal** (Python, `headroom proxy`). Tanpa Headroom toggle-nya mati, sisanya tetap jalan.

### Konfigurasi

`config.yaml` hot-reload — edit lewat dashboard/API langsung berlaku tanpa restart. Lihat `config.example.yaml` untuk semua bentuk provider.

**Combo** = entry `models`: alias → rantai provider. Strategy: `fallback` (default) atau `round-robin`.

**Resolusi model**: alias combo → `provider/model` → id model polos (deteksi otomatis).

### Environment

Gateway: `AIGETWEY_CONFIG`, `AIGETWEY_DATA_DIR`, `AIGETWEY_ADMIN_PASSWORD`, `AIGETWEY_PORT`.

Dashboard: `GATEWAY_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`.

Password admin dan key provider tidak pernah sampai ke browser.

---

## Acknowledgements

Inspired by [9router](https://github.com/decolua/9router) — its feature set and dashboard shaped much of this project's direction.

## License

[MIT](./LICENSE) © xk1ko

## Contributing

Issues and ideas welcome: <https://github.com/xk1ko/aigetwey/issues>
