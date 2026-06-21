/** Status lamp — green when serving, red pulse on cooldown, grey when idle. */
export function Lamp({ state, title }: { state: "live" | "idle" | "down"; title?: string }) {
  return <span className={`lamp lamp-${state}`} title={title} aria-label={state} />;
}

export function lampFor(healthy: boolean): "live" | "down" {
  return healthy ? "live" : "down";
}
