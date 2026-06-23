import { EndpointView } from "@/components/EndpointView";

// Landing page IS Endpoint & Key — same as 9router, where "/dashboard" renders
// the endpoint view (gateway URL + keys + token savers), the first thing you
// need to wire up a CLI tool.
export default function LandingPage() {
  return <EndpointView />;
}
