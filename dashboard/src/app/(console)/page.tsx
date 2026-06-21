import Link from "next/link";
import { gateway } from "@/lib/gateway";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Stat, fmt, Empty } from "@/components/ui";

// status reflects live gateway state — never cache.
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = startOfDay.getTime();

  const [usageRes, provRes, cfgRes] = await Promise.all([
    gateway.usage(since),
    gateway.providers(),
    gateway.config(),
  ]);

  if (!provRes.ok && !usageRes.ok) {
    return (
      <div>
        <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-text">Overview</h1>
        <Empty>Could not reach the gateway. Is it running on its configured port?</Empty>
      </div>
    );
  }

  const usage = usageRes.data;
  const providers = provRes.data?.providers ?? [];
  const config = cfgRes.data;

  const healthyCount = providers.filter((p) => p.keys.some((k) => k.healthy)).length;
  const ep = config?.endpoint;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Lamp state="live" />
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Overview</h1>
        <Badge tone="live">gateway up</Badge>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Requests today" value={fmt.int(usage?.total.requests ?? 0)} />
        <Stat label="Tokens today" value={fmt.compact((usage?.total.tokens_in ?? 0) + (usage?.total.tokens_out ?? 0))} />
        <Stat label="Cost today" value={fmt.cost(usage?.total.cost ?? 0)} />
        <Stat label="Providers healthy" value={`${healthyCount}/${providers.length}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RichCard
          header={
            <>
              <CardTitle title="Provider health" />
              <Link href="/providers" className="text-[12px] text-text-subtle hover:text-text">
                Manage →
              </Link>
            </>
          }
        >
          {providers.length === 0 ? (
            <Empty>No providers configured.</Empty>
          ) : (
            <div className="space-y-1.5">
              {providers.map((p) => {
                const healthy = p.keys.some((k) => k.healthy);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-brand border border-border-subtle px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Lamp state={healthy ? "live" : "down"} />
                      <span className="text-[13px] text-text">{p.id}</span>
                      <Badge tone="info">{p.format}</Badge>
                    </div>
                    <span className="tnum text-[12px] text-text-subtle">
                      {p.keys.filter((k) => k.healthy).length}/{p.keys.length} keys
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </RichCard>

        <RichCard header={<CardTitle title="Active configuration" />}>
          <div className="space-y-3 text-[13px]">
            <Row label="Combos">
              <span className="tnum text-text">{config?.models.length ?? 0}</span>
            </Row>
            <Row label="RTK">
              <Badge tone={ep?.rtk ? "live" : "neutral"}>{ep?.rtk ? "on" : "off"}</Badge>
            </Row>
            <Row label="Caveman">
              <Badge tone={ep && ep.caveman !== "off" ? "info" : "neutral"}>{ep?.caveman ?? "off"}</Badge>
            </Row>
            <Row label="Ponytail">
              <Badge tone={ep && ep.ponytail !== "off" ? "info" : "neutral"}>{ep?.ponytail ?? "off"}</Badge>
            </Row>
          </div>
        </RichCard>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-subtle">{label}</span>
      {children}
    </div>
  );
}
