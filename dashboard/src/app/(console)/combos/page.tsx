import { RoutingView } from "@/components/RoutingView";
import { ComboManager } from "@/components/ComboManager";

/**
 * Combos & Routing — one page, two sections (mirrors 9router, which folds
 * routing into Combos): the live alias table on top, saved presets below.
 */
export default function CombosPage() {
  return (
    <div>
      <h1 className="mb-6 text-[22px] font-semibold tracking-tight text-text">Combos &amp; Routing</h1>
      <div className="space-y-10">
        <RoutingView />
        <ComboManager />
      </div>
    </div>
  );
}
