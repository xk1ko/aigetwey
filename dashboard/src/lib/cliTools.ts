/**
 * CLI tool setup definitions. Each tool talks to the gateway in either OpenAI or
 * Anthropic wire format; the gateway exposes both on the same port, so setup is
 * just pointing the tool's base_url + key at us. `env` builders take the live
 * gateway base URL + a gateway key and return ready-to-copy environment lines.
 */
export type ToolFormat = "openai" | "anthropic";

export interface CliTool {
  id: string;
  name: string;
  format: ToolFormat;
  blurb: string;
  /** environment variables to set, given the gateway base + a key. */
  env: (base: string, key: string) => Array<{ name: string; value: string }>;
  /** extra free-form steps shown on the detail page. */
  steps: string[];
}

const KEY = (k: string) => k || "<your-gateway-key>";

export const CLI_TOOLS: CliTool[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    format: "anthropic",
    blurb: "Anthropic CLI. Point its base URL + key at the gateway.",
    env: (base, key) => [
      { name: "ANTHROPIC_BASE_URL", value: base },
      { name: "ANTHROPIC_API_KEY", value: KEY(key) },
    ],
    steps: [
      "Export the two variables in the shell you run `claude` from.",
      "Call a model by a routing alias you defined under Routing (e.g. claude-sonnet-4-6).",
      "The gateway translates Anthropic ↔ provider format, so any provider works behind it.",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    format: "openai",
    blurb: "OpenAI-compatible. Use the /v1 base URL.",
    env: (base, key) => [
      { name: "OPENAI_BASE_URL", value: `${base}/v1` },
      { name: "OPENAI_API_KEY", value: KEY(key) },
    ],
    steps: ["Set the base URL to the gateway's /v1 path.", "Use a routing alias as the model name."],
  },
  {
    id: "opencode",
    name: "opencode",
    format: "openai",
    blurb: "OpenAI-compatible provider. Set base_url to /v1.",
    env: (base, key) => [
      { name: "OPENAI_BASE_URL", value: `${base}/v1` },
      { name: "OPENAI_API_KEY", value: KEY(key) },
    ],
    steps: ["Add an OpenAI-compatible provider with the gateway /v1 base URL.", "Pick a routing alias as the model."],
  },
  {
    id: "cursor",
    name: "Cursor",
    format: "openai",
    blurb: "OpenAI-compatible. Override the base URL in settings.",
    env: (base, key) => [
      { name: "Base URL", value: `${base}/v1` },
      { name: "API Key", value: KEY(key) },
    ],
    steps: [
      "Settings → Models → OpenAI API Key → override base URL with the gateway /v1.",
      "Add your routing aliases as custom model names.",
    ],
  },
  {
    id: "cline",
    name: "Cline",
    format: "openai",
    blurb: "OpenAI-compatible VS Code agent.",
    env: (base, key) => [
      { name: "Base URL", value: `${base}/v1` },
      { name: "API Key", value: KEY(key) },
    ],
    steps: ["Choose the OpenAI-compatible provider.", "Set the base URL to the gateway /v1 and use a routing alias."],
  },
];

export function toolById(id: string): CliTool | undefined {
  return CLI_TOOLS.find((t) => t.id === id);
}
