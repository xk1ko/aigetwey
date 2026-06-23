import { gateway } from "@/lib/gateway";
import { UsageView } from "@/components/UsageView";
import { LogTable } from "@/components/LogTable";
import { Empty } from "@/components/ui";

// always fresh — logs change every request.
export const dynamic = "force-dynamic";

// Usage = stats/charts + the full request log (with the detail drawer). 9router
// keeps request logs inside Usage rather than a separate menu, so we do too.
export default async function UsagePage() {
  const res = await gateway.logs(200);
  const logs = res.data?.logs ?? [];

  return (
    <div className="space-y-7">
      <UsageView />
      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-text">Requests</h2>
        {res.ok ? <LogTable logs={logs} /> : <Empty>Could not reach the gateway: {res.error}</Empty>}
      </div>
    </div>
  );
}
