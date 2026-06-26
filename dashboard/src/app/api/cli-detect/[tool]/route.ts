import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { modalitiesForModel } from "@/lib/capabilities";

/**
 * Local CLI-tool detection + auto-config. These run in the Next.js server (which,
 * like the gateway, lives on the operator's machine), so they can read/write the
 * tool's own config files — the trick behind aigetwey's "it just detects and
 * configures itself". Session-gated by middleware like every other /api route.
 *
 * Only claude-code + opencode auto-configure (the two with a stable local config
 * file we can safely merge into). Others report installed:false → the UI falls
 * back to the manual env block.
 */
const execAsync = promisify(exec);

type Json = Record<string, unknown>;

async function onPath(bin: string): Promise<boolean> {
  try {
    const cmd = os.platform() === "win32" ? `where ${bin}` : `which ${bin}`;
    await execAsync(cmd, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// tolerate JSONC (trailing commas) and unparseable files (treat as "no config").
function readJson(content: string): Json | null {
  try {
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1")) as Json;
  } catch {
    return null;
  }
}

// ─── Claude Code: ~/.claude/settings.json env block ─────────────────────────
const claudePath = () => path.join(os.homedir(), ".claude", "settings.json");
const CLAUDE_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
];

async function claudeStatus() {
  const installed = (await onPath("claude")) || (await fileExists(claudePath()));
  if (!installed) return { installed: false as const };
  let settings: Json | null = null;
  try {
    settings = readJson(await fs.readFile(claudePath(), "utf-8"));
  } catch {
    settings = null;
  }
  const env = (settings?.env as Json | undefined) ?? {};
  return {
    installed: true as const,
    configured: typeof env.ANTHROPIC_BASE_URL === "string",
    path: claudePath(),
    baseUrl: (env.ANTHROPIC_BASE_URL as string) ?? null,
    modelSlots: {
      opus: (env.ANTHROPIC_DEFAULT_OPUS_MODEL as string) ?? null,
      sonnet: (env.ANTHROPIC_DEFAULT_SONNET_MODEL as string) ?? null,
      haiku: (env.ANTHROPIC_DEFAULT_HAIKU_MODEL as string) ?? null,
    },
  };
}

async function claudeApply(body: { base?: string; key?: string; models?: Record<string, string> }) {
  if (!body.base) return { error: "base is required" };
  const p = claudePath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  let cur: Json = {};
  try {
    cur = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    cur = {};
  }
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: body.base,
  };
  if (body.key) env.ANTHROPIC_AUTH_TOKEN = body.key;
  if (body.models?.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = body.models.opus;
  if (body.models?.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = body.models.sonnet;
  if (body.models?.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = body.models.haiku;
  const next = { ...cur, hasCompletedOnboarding: true, env: { ...((cur.env as Json) ?? {}), ...env } };
  await fs.writeFile(p, JSON.stringify(next, null, 2));
  return { success: true, path: p };
}

async function claudeReset() {
  const p = claudePath();
  let cur: Json;
  try {
    cur = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    return { success: true };
  }
  const env = cur.env as Json | undefined;
  if (env) {
    for (const k of CLAUDE_KEYS) delete env[k];
    if (Object.keys(env).length === 0) delete cur.env;
  }
  await fs.writeFile(p, JSON.stringify(cur, null, 2));
  return { success: true };
}

// ─── opencode: ~/.config/opencode/opencode.json provider entry ──────────────
const OC_PROVIDER = "aigetwey";
const ocDir = () => path.join(os.homedir(), ".config", "opencode");
const ocPath = () => path.join(ocDir(), "opencode.json");

async function opencodeStatus() {
  const installed = (await onPath("opencode")) || (await fileExists(ocPath()));
  if (!installed) return { installed: false as const };
  let cfg: Json | null = null;
  try {
    cfg = readJson(await fs.readFile(ocPath(), "utf-8"));
  } catch {
    cfg = null;
  }
  const prov = (cfg?.provider as Json | undefined)?.[OC_PROVIDER] as Json | undefined;
  const models = prov?.models ? Object.keys(prov.models as Json) : [];
  const active = typeof cfg?.model === "string" && cfg.model.startsWith(`${OC_PROVIDER}/`)
    ? cfg.model.slice(OC_PROVIDER.length + 1)
    : null;
  return {
    installed: true as const,
    configured: !!prov,
    path: ocPath(),
    models,
    activeModel: active,
    baseUrl: ((prov?.options as Json | undefined)?.baseURL as string) ?? null,
  };
}

async function opencodeApply(body: { base?: string; key?: string; models?: string[]; active?: string }) {
  const models = (body.models ?? []).filter(Boolean);
  if (!body.base || models.length === 0) return { error: "base and at least one model are required" };
  const p = ocPath();
  await fs.mkdir(ocDir(), { recursive: true });
  let cfg: Json = {};
  try {
    cfg = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    cfg = {};
  }
  const baseURL = body.base.endsWith("/v1") ? body.base : `${body.base}/v1`;
  const provider = (cfg.provider as Json | undefined) ?? {};
  const existing = (provider[OC_PROVIDER] as Json | undefined) ?? {
    npm: "@ai-sdk/openai-compatible",
    options: {},
    models: {},
  };
  existing.options = { ...((existing.options as Json) ?? {}), baseURL, apiKey: body.key || "aigetwey" };
  const modelMap = (existing.models as Json) ?? {};
  for (const m of models) modelMap[m] = { name: m, modalities: modalitiesForModel(m) };
  existing.models = modelMap;
  provider[OC_PROVIDER] = existing;
  cfg.provider = provider;
  const active = body.active && models.includes(body.active) ? body.active : models[0];
  cfg.model = `${OC_PROVIDER}/${active}`;
  await fs.writeFile(p, JSON.stringify(cfg, null, 2));
  return { success: true, path: p };
}

async function opencodeReset() {
  const p = ocPath();
  let cfg: Json;
  try {
    cfg = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    return { success: true };
  }
  const provider = cfg.provider as Json | undefined;
  if (provider) delete provider[OC_PROVIDER];
  if (typeof cfg.model === "string" && cfg.model.startsWith(`${OC_PROVIDER}/`)) delete cfg.model;
  await fs.writeFile(p, JSON.stringify(cfg, null, 2));
  return { success: true };
}

type ApplyBody = { base?: string; key?: string; models?: string[] | Record<string, string>; active?: string };
const HANDLERS: Record<
  string,
  { status: () => Promise<unknown>; apply: (b: ApplyBody) => Promise<unknown>; reset: () => Promise<unknown> }
> = {
  "claude-code": {
    status: claudeStatus,
    apply: (b) => claudeApply(b as { base?: string; key?: string; models?: Record<string, string> }),
    reset: claudeReset,
  },
  opencode: {
    status: opencodeStatus,
    apply: (b) => opencodeApply(b as { base?: string; key?: string; models?: string[]; active?: string }),
    reset: opencodeReset,
  },
};

type Ctx = { params: Promise<{ tool: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ installed: false, auto: false });
  try {
    return NextResponse.json({ auto: true, ...(await h.status() as object) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ error: "tool does not support auto-config" }, { status: 400 });
  try {
    const body = (await req.json()) as ApplyBody;
    const res = (await h.apply(body)) as { error?: string };
    if (res.error) return NextResponse.json(res, { status: 400 });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ error: "tool does not support auto-config" }, { status: 400 });
  try {
    return NextResponse.json(await h.reset() as object);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
