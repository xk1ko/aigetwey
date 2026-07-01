import { gw } from "@/lib/gw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Actually boots gw() (config load, db, auth store) instead of a static
// {ok:true} — a broken config.yaml now surfaces here as a 503 during the
// launcher's startup poll, instead of binding the port successfully and only
// failing later on the first real /admin or /v1 request.
export async function GET(): Promise<Response> {
  try {
    gw();
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
  return Response.json({ ok: true });
}
