import { RoutingView } from "@/components/RoutingView";

/**
 * Combos & Routing — one concept (aigloo-style): each combo is an alias + an
 * ordered provider chain + a strategy. Call the alias as the model name from a
 * CLI tool. No separate snapshot layer.
 */
export default function CombosPage() {
  return <RoutingView />;
}
