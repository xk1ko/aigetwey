/**
 * Overview placeholder. The full status dashboard (request counts, RTK savings,
 * active combo, provider health) is built in phase 11; this stub exists so the
 * (console) route group renders behind the rail/topbar shell and login flow can
 * be verified end to end.
 */
export default function OverviewPage() {
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-text">Overview</h1>
      <p className="mt-2 text-[13px] text-text-muted">
        Console shell is up. Status cards, provider health, and usage land in the next phase.
      </p>
    </div>
  );
}
