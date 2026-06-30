import { dispatchEmbeddings } from "@/lib/v1-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return dispatchEmbeddings(req);
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key, anthropic-version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
