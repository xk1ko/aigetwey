/**
 * CLI tool setup definitions. Each tool talks to the gateway in either OpenAI or
 * Anthropic wire format; the gateway exposes both on the same port, so setup is
 * just pointing the tool's base_url + key at us. `env` builders take the live
 * gateway base URL + a gateway key and return ready-to-copy environment lines.
 *
 * `slots` are the model names this tool calls. Because our gateway routes by the
 * combo alias (the alias IS the model name), the detail page checks whether a
 * combo with each slot's alias exists, and prompts to create the missing ones.
 */
export type ToolFormat = "openai" | "anthropic";

export interface CliTool {
  id: string;
  name: string;
  /** Material Symbols ligature shown on the tool card + detail header. */
  icon: string;
  format: ToolFormat;
  blurb: string;
  /** true when the dashboard can detect + write this tool's local config file. */
  autoConfig?: boolean;
  /** one-line install command, when the tool ships via a package manager. */
  install?: string;
  /** model names the tool sends — pair each with a combo of the same name. */
  slots: { label: string; alias: string }[];
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
    blurb: "Coding agent CLI. Routes any model through the gateway.",
    autoConfig: true,
    install: "npm i -g @anthropic-ai/claude-code",
    slots: [
      { label: "Opus · heavy", alias: "claude-opus-4-1" },
      { label: "Sonnet · default", alias: "claude-sonnet-4-6" },
      { label: "Haiku · fast", alias: "claude-haiku-4-5" },
    ],
    env: (base, key) => [
      { name: "ANTHROPIC_BASE_URL", value: base },
      { name: "ANTHROPIC_API_KEY", value: KEY(key) },
    ],
    steps: [
      "Export the two variables in the shell you run `claude` from.",
      "Create a combo named like each slot above so Claude Code's model ids resolve.",
      "The gateway translates Anthropic ↔ provider format, so any provider works behind it.",
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    icon: "code_blocks",
    format: "openai",
    blurb: "Open-source coding agent. Any model via the gateway /v1 endpoint.",
    autoConfig: true,
    install: "curl -fsSL https://opencode.ai/install | bash",
    slots: [{ label: "Model", alias: "gpt-5" }],
    env: (base, key) => [
      { name: "OPENAI_BASE_URL", value: `${base}/v1` },
      { name: "OPENAI_API_KEY", value: KEY(key) },
    ],
    steps: ["Add an OpenAI-compatible provider with the gateway /v1 base URL.", "Pick a combo alias as the model."],
  },
];

export function toolById(id: string): CliTool | undefined {
  return CLI_TOOLS.find((t) => t.id === id);
}
