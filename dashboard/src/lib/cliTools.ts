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
  /** Material Symbols ligature shown on the tool card + detail header. */
  icon: string;
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
    icon: "smart_toy",
    format: "anthropic",
    blurb: "Anthropic CLI. Point its base URL + key at the gateway.",
    env: (base, key) => [
      { name: "ANTHROPIC_BASE_URL", value: base },
      { name: "ANTHROPIC_API_KEY", value: KEY(key) },
    ],
    steps: [
      "Export the two variables in the shell you run `claude` from.",
      "Call a model by a combo alias you defined under Combos (e.g. claude-sonnet-4-6).",
      "The gateway translates Anthropic ↔ provider format, so any provider works behind it.",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    icon: "code",
    format: "openai",
    blurb: "OpenAI-compatible. Use the /v1 base URL.",
    env: (base, key) => [
      { name: "OPENAI_BASE_URL", value: `${base}/v1` },
      { name: "OPENAI_API_KEY", value: KEY(key) },
    ],
    steps: ["Set the base URL to the gateway's /v1 path.", "Use a combo alias as the model name."],
  },
  {
    id: "opencode",
    name: "opencode",
    icon: "code_blocks",
    format: "openai",
    blurb: "OpenAI-compatible provider. Set base_url to /v1.",
    env: (base, key) => [
      { name: "OPENAI_BASE_URL", value: `${base}/v1` },
      { name: "OPENAI_API_KEY", value: KEY(key) },
    ],
    steps: ["Add an OpenAI-compatible provider with the gateway /v1 base URL.", "Pick a combo alias as the model."],
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "edit_square",
    format: "openai",
    blurb: "OpenAI-compatible. Override the base URL in settings.",
    env: (base, key) => [
      { name: "Base URL", value: `${base}/v1` },
      { name: "API Key", value: KEY(key) },
    ],
    steps: [
      "Settings → Models → OpenAI API Key → override base URL with the gateway /v1.",
      "Add your combo aliases as custom model names.",
    ],
  },
  {
    id: "cline",
    name: "Cline",
    icon: "extension",
    format: "openai",
    blurb: "OpenAI-compatible VS Code agent.",
    env: (base, key) => [
      { name: "Base URL", value: `${base}/v1` },
      { name: "API Key", value: KEY(key) },
    ],
    steps: ["Choose the OpenAI-compatible provider.", "Set the base URL to the gateway /v1 and use a combo alias."],
  },
];

export function toolById(id: string): CliTool | undefined {
  return CLI_TOOLS.find((t) => t.id === id);
}
