/**
 * Vertex AI auth via a GCP service account (not user OAuth). Reads the service
 * account JSON, mints a signed JWT, and exchanges it for an access token at
 * Google's token endpoint. Tokens are cached and refreshed shortly before expiry
 * so the hot request path never blocks on a network round-trip when avoidable.
 *
 * The access token becomes the provider's bearer key in the upstream client;
 * Vertex models otherwise speak the Gemini format the gemini adapter already
 * handles.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { request } from "undici";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
// refresh this many ms before the real expiry so a token never goes stale mid-flight.
const EXPIRY_SKEW_MS = 60_000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadServiceAccount(path: string): ServiceAccount {
  const sa = JSON.parse(readFileSync(path, "utf8")) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error(`service account ${path} missing client_email/private_key`);
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

/** Build and RS256-sign the JWT assertion used in the token exchange. */
function buildAssertion(sa: ServiceAccount, nowSec: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number; // ms epoch
}

/**
 * Token provider for one service account file. Caches the access token and
 * exchanges a new one only when the cached token is missing or near expiry.
 * In-memory only — restart re-mints, which is fine for personal use.
 */
export class VertexAuth {
  private cache: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly serviceAccountPath: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** A valid access token, minting/refreshing if needed. */
  async getToken(): Promise<string> {
    const t = this.now();
    if (this.cache && this.cache.expiresAt - EXPIRY_SKEW_MS > t) return this.cache.token;
    // collapse concurrent refreshes so a burst of requests mints only one token.
    if (this.inflight) return this.inflight;
    this.inflight = this.exchange().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async exchange(): Promise<string> {
    const sa = loadServiceAccount(this.serviceAccountPath);
    const nowSec = Math.floor(this.now() / 1000);
    const assertion = buildAssertion(sa, nowSec);

    const res = await request(sa.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });

    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`vertex token exchange failed (${res.statusCode}): ${text}`);
    }

    const body = (await res.body.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("vertex token exchange returned no access_token");

    const ttlMs = (body.expires_in ?? 3600) * 1000;
    this.cache = { token: body.access_token, expiresAt: this.now() + ttlMs };
    return body.access_token;
  }
}

// expose internals for unit testing the JWT build without a network call.
export const _internal = { buildAssertion, base64url, loadServiceAccount };
