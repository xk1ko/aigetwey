import { ToolDetail } from "@/components/ToolDetail";

export default async function ToolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ToolDetail id={decodeURIComponent(id)} />;
}
