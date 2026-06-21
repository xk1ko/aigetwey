import { ProviderDetail } from "@/components/ProviderDetail";

export default async function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProviderDetail id={decodeURIComponent(id)} />;
}
