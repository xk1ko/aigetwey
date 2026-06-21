import { gateway } from "@/lib/gateway";
import { LogTable } from "@/components/LogTable";
import { Empty } from "@/components/ui";

// always fresh — logs change every request.
export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const res = await gateway.logs(200);
  const logs = res.data?.logs ?? [];

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-text">Logs</h1>
      <p className="mb-6 text-[13px] text-text-muted">The most recent requests through the gateway.</p>
      {res.ok ? (
        <LogTable logs={logs} />
      ) : (
        <Empty>Could not reach the gateway: {res.error}</Empty>
      )}
    </div>
  );
}
