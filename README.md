<p align="center">
  <img src="./assets/wordmark.svg" width="420" alt="aigetwey">
</p>

# aigetwey

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/aigetwey.svg)](https://www.npmjs.com/package/aigetwey)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

Personal AI gateway. One local endpoint takes requests from your CLI coding
tools (Claude Code, opencode, Cursor, Cline, Codex), translates between formats,
routes with fallback across providers, and tracks token usage and cost. Ships
with a built-in dashboard.

<p align="center">
  <img src="./assets/screenshot.png" width="860" alt="aigetwey dashboard — Endpoint & Key">
</p>

**🌐 Language / Bahasa:** [English](#english) · [Bahasa Indonesia](#bahasa-indonesia)

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## English

### Highlights

- **One endpoint, every format** — clients speak OpenAI (`/v1/chat/completions`)
  or Anthropic (`/v1/messages`); the gateway translates to/from OpenAI- and
  Anthropic-compatible providers, streaming included.
- **Routing + fallback** — a client alias resolves to a prioritized provider
  chain; on 429/5xx/timeout it rotates keys and falls through to the next.
- **Token savers** — RTK compresses bulky `tool_result` blocks; caveman trims
  output prose; ponytail nudges minimal code; headroom compresses context via an
  external `/v1/compress`. All toggle per-endpoint.
- **Share it safely** — hand a gateway key to a teammate or a friend and set its
  model allowlist, rate limit, **spend cap**, and **expiry** in one place. Each
  key's budget resets on its own rolling cycle, so a shared key behaves like a
  self-renewing monthly allowance; an expired key is refused with `403`.
- **Budgets + cost** — scoped spend caps (global/provider/model/key) over rolling
  `5h`/`24h`/`7day`/`30day` windows anchored to when each budget was created, with a
  live reset countdown and SQLite-backed usage/cost tracking. The Budgets page
  splits **Overall** caps from a **Keys** view that shows every key's spend.
- **Dashboard** — providers, combos, usage, budgets, CLI tools, a live server
  console, and a settings page with a per-model pricing editor.

### Token savers

Toggle these per-endpoint in the dashboard. The first three are **built into the
gateway** — nothing extra to install, they ship with the npm package. Headroom is
the only one that needs an **external** tool.

| Saver | What it does | Upstream | Install |
| --- | --- | --- | --- |
| **RTK** | Compresses bulky `tool_result` blocks in the request (git/grep/ls/logs). | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | built-in |
| **Caveman** | Terse-output system prompt — cuts output prose tokens. | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | built-in |
| **Ponytail** | Biases the model toward minimal code (YAGNI, reuse, deletion). | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | built-in |
| **Headroom** | Pipes context through an external `/v1/compress` proxy. | [chopratejas/headroom](https://github.com/chopratejas/headroom) | **external** |

**Headroom** is the only external piece — a separate Python tool the gateway just
detects and calls, never bundled. Install it from
[chopratejas/headroom](https://github.com/chopratejas/headroom) (Python ≥ 3.10),
then run `headroom proxy` (default `http://localhost:8787`). With it absent the
Headroom toggle stays off and everything else works unchanged. The dashboard's
Endpoint &amp; Key page shows install status and a one-line install hint.

### Install

**Global (npm):**

```bash
npm install -g aigetwey
aigetwey
```

The first run self-bootstraps: it seeds a `config.yaml`, installs the dashboard's
dependencies, builds the dashboard, then starts the gateway + dashboard and opens
your browser. Subsequent runs start instantly.

On a terminal a menu lets you choose **Web UI**, **Terminal** (logs only),
**Hide to Tray** (background with a tray icon: Open Dashboard / Auto-start / Quit,
macOS + Linux), or **Exit**. Flags: `-p/--port`, `-n/--no-browser`, `-y/--yes`
(skip the menu), `-t/--tray`, `-h/--help`.

**From source:**

```bash
git clone https://github.com/xk1ko/aigetwey.git
cd aigetwey
npm install
cp config.example.yaml config.yaml      # then edit: add providers + a server key
npm install --prefix dashboard
./run.sh                                  # gateway + dashboard (Ctrl-C stops both)
```

An admin password is generated if `AIGETWEY_ADMIN_PASSWORD` isn't set (printed on
startup). Set it to keep it stable across runs. **One URL serves everything** —
`http://127.0.0.1:18080`: the dashboard, the API (`/v1`, `/messages`), and the
admin endpoints. The gateway reverse-proxies the dashboard, so clients and the
console share a single address.

### Configuration

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
  - id: opencode-free
    format: openai
    base_url: https://opencode.ai/zen/v1
    free: true              # no upstream auth
    auto_models: true       # fetch the catalog at runtime

models:                     # routing: client alias -> prioritized provider chain
  - alias: claude-sonnet-4-6
    target: [anthropic, opencode-free]   # fallback order
    model: [claude-sonnet-4-6, claude-sonnet-4-5]
    price_in: 3             # USD per 1M tokens (for cost tracking)
    price_out: 15

budgets:                    # spend caps; window = rolling 5h | 24h | 7day | 30day
  - scope: { type: global }
    unit: usd               # usd (cost) or tokens
    limit: 50
    window: 30day           # rolling 30-day lookback (epoch-aligned bucket)
```

A **combo** is one of these `models` entries: an alias your CLI tool calls,
routed to an ordered provider chain. `strategy: fallback` (default) tries the
chain in order, falling through on 429/5xx/timeout; `strategy: round-robin`
rotates the first provider tried per request to spread load.

### Connecting CLI tools

The dashboard's **CLI Tools** page detects local tools and writes their config
for you (Claude Code, opencode), or generates copy-ready env. In short, point the
tool's base URL + key at the gateway and call a routing alias as the model name:

```bash
# Claude Code (Anthropic format)
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (OpenAI format)
export OPENAI_BASE_URL=http://127.0.0.1:18080/v1
export OPENAI_API_KEY=my-key
```

**Naming a model** — the `model` field resolves three ways, in order: (1) a
**combo alias** → its provider chain; (2) **`provider/model`** (e.g.
`anthropic/claude-sonnet-4-6`) → straight to that provider; (3) a **bare model
id** → auto-detected against every provider's catalog.

### Environment

Gateway: `AIGETWEY_CONFIG` (config path), `AIGETWEY_DATA_DIR` (usage DB dir),
`AIGETWEY_ADMIN_PASSWORD` (admin + dashboard), `AIGETWEY_PORT` (listen port).

Dashboard (`dashboard/.env.local`): `GATEWAY_URL`, `ADMIN_PASSWORD` (must match
the gateway), `SESSION_SECRET` (`openssl rand -hex 32`).

The admin password and provider keys never reach the browser: the dashboard
proxies `/admin/*` server-side with the Bearer injected, and keys are masked.

### Development

```bash
npm run typecheck       # tsc, no emit
npm test                # vitest (unit + synthetic E2E)
npm run build           # compile to dist/
```

---

## Bahasa Indonesia

### Sorotan

- **Satu endpoint, semua format** — klien bicara OpenAI (`/v1/chat/completions`)
  atau Anthropic (`/v1/messages`); gateway menerjemahkan ke/dari provider yang
  kompatibel OpenAI & Anthropic, termasuk streaming.
- **Routing + fallback** — sebuah alias klien diarahkan ke rantai provider
  berprioritas; saat 429/5xx/timeout ia memutar key dan jatuh ke provider
  berikutnya.
- **Penghemat token** — RTK memampatkan blok `tool_result` besar; caveman
  meringkas prosa output; ponytail mendorong kode minimal; headroom memampatkan
  konteks lewat `/v1/compress` eksternal. Semua bisa di-toggle per-endpoint.
- **Bagikan dengan aman** — kasih satu gateway key ke teman/rekan, lalu atur
  allowlist model, rate limit, **batas spend**, dan **kedaluwarsa** di satu tempat.
  Budget tiap key reset di siklus rolling-nya sendiri (jadi terasa seperti jatah
  bulanan yang isi ulang otomatis); key yang kedaluwarsa ditolak `403`.
- **Budget + biaya** — batas spend berskop (global/provider/model/key) atas jendela
  rolling `5h`/`24h`/`7day`/`30day` yang di-anchor ke saat budget dibuat, dengan
  hitung mundur reset dan pelacakan pemakaian/biaya berbasis SQLite. Halaman Budgets
  memisah cap **Overall** dari tampilan **Keys** (pemakaian tiap key).
- **Dashboard** — providers, combos, usage, budgets, CLI tools, server console
  live, dan halaman settings dengan editor harga per-model.

### Penghemat token

**RTK** ([rtk-ai/rtk](https://github.com/rtk-ai/rtk)), **Caveman**
([JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)), **Ponytail**
([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)) =
**built-in** (ikut paket npm, tak perlu install apa pun). Hanya **Headroom**
([chopratejas/headroom](https://github.com/chopratejas/headroom)) yang
**eksternal**: tool Python terpisah (tidak di-bundle — gateway cuma mendeteksi &
memanggilnya), butuh Python ≥ 3.10, jalankan `headroom proxy` (default
`http://localhost:8787`). Tanpa Headroom toggle-nya mati & sisanya tetap jalan;
halaman Endpoint &amp; Key di dashboard menampilkan status install + hint.

### Instalasi

**Global (npm):**

```bash
npm install -g aigetwey
aigetwey
```

Saat pertama dijalankan ia bootstrap otomatis: membuat `config.yaml`, meng-install
dependency dashboard, build dashboard, lalu menjalankan gateway + dashboard dan
membuka browser. Run berikutnya langsung jalan.

**Dari source:**

```bash
git clone https://github.com/xk1ko/aigetwey.git
cd aigetwey
npm install
cp config.example.yaml config.yaml      # lalu edit: tambah provider + server key
npm install --prefix dashboard
./run.sh                                  # gateway + dashboard (Ctrl-C hentikan keduanya)
```

Admin password dibuat otomatis kalau `AIGETWEY_ADMIN_PASSWORD` belum di-set
(dicetak saat start). Set agar stabil antar run. **Satu URL untuk semuanya** —
`http://127.0.0.1:18080`: dashboard, API (`/v1`, `/messages`), dan admin. Gateway
mem-proxy dashboard, jadi client & console pakai satu alamat.

### Konfigurasi

`config.yaml` adalah sumber kebenaran dan **hot-reload** — perubahan lewat
dashboard (atau API) langsung berlaku tanpa restart. Lihat `config.example.yaml`
untuk semua bentuk provider. Intinya sama seperti contoh di bagian English di
atas (`server`, `endpoint`, `providers`, `models`).

Sebuah **combo** adalah satu entry `models`: alias yang dipanggil CLI tool-mu,
diarahkan ke rantai provider berurutan. `strategy: fallback` (default) mencoba
rantai berurutan, jatuh saat 429/5xx/timeout; `strategy: round-robin` memutar
provider pertama tiap request untuk membagi beban.

### Menghubungkan CLI tools

Halaman **CLI Tools** di dashboard mendeteksi tool lokal dan menulis config-nya
untukmu (Claude Code, opencode), atau menghasilkan env siap-salin. Singkatnya,
arahkan base URL + key tool ke gateway dan panggil alias routing sebagai nama
model:

```bash
# Claude Code (format Anthropic)
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (format OpenAI)
export OPENAI_BASE_URL=http://127.0.0.1:18080/v1
export OPENAI_API_KEY=my-key
```

**Penamaan model** — field `model` diselesaikan tiga cara, berurutan: (1) **alias
combo** → rantai provider-nya; (2) **`provider/model`** (mis.
`anthropic/claude-sonnet-4-6`) → langsung ke provider itu; (3) **id model polos**
→ dideteksi otomatis dari katalog tiap provider.

### Environment

Gateway: `AIGETWEY_CONFIG` (path config), `AIGETWEY_DATA_DIR` (folder DB usage),
`AIGETWEY_ADMIN_PASSWORD` (admin + dashboard), `AIGETWEY_PORT` (port listen).

Dashboard (`dashboard/.env.local`): `GATEWAY_URL`, `ADMIN_PASSWORD` (harus sama
dengan gateway), `SESSION_SECRET` (`openssl rand -hex 32`).

Admin password dan key provider tak pernah sampai ke browser: dashboard
mem-proxy `/admin/*` di sisi server dengan Bearer disuntik, dan key disamarkan.

### Pengembangan

```bash
npm run typecheck       # tsc, tanpa emit
npm test                # vitest (unit + E2E sintetis)
npm run build           # compile ke dist/
```

---

## Acknowledgements

Inspired by [9router](https://github.com/decolua/9router) — its feature set and dashboard shaped much of this project's direction. / Terinspirasi oleh [9router](https://github.com/decolua/9router).

## License

[MIT](./LICENSE) © xk1ko

## Contributing

Issues and ideas welcome: <https://github.com/xk1ko/aigetwey/issues>
