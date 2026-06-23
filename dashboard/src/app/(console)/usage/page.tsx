import { UsageView } from "@/components/UsageView";
import { RecentRequests } from "@/components/RecentRequests";

export default function UsagePage() {
  return (
    <div className="space-y-5">
      <UsageView />
      <RecentRequests />
    </div>
  );
}
