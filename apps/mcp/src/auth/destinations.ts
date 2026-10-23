/** Cloudflare Email Routing destination addresses: on the free plan sign-in emails only reach verified ones. */
export interface DestinationEnv {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

export type DestinationResult =
  | { status: 'verification_sent' }
  | { status: 'already_registered'; verified: boolean }
  | { status: 'not_configured' }
  | { status: 'failed'; reason: string };

export type DestinationRegistrar = (email: string) => Promise<DestinationResult>;

interface CfResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { email?: string; verified?: string | null }[];
}

const API = 'https://api.cloudflare.com/client/v4';

/**
 * Registers an address as a destination (Cloudflare then emails the person a verification link they must click).
 * Needs the secrets CF_ACCOUNT_ID and CF_API_TOKEN (token permission: Account > Email Routing Addresses > Edit).
 */
export function cloudflareDestinations(env: DestinationEnv, doFetch: typeof fetch = fetch): DestinationRegistrar {
  return async (email) => {
    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return { status: 'not_configured' };
    const url = `${API}/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/email/routing/addresses`;
    const headers = { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' };
    try {
      const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify({ email }) });
      const body = (await res.json().catch(() => ({}))) as CfResponse;
      if (res.ok && body.success !== false) return { status: 'verification_sent' };
      // Already added: report whether it is verified yet (the API refuses a duplicate).
      const existing = await findDestination(url, headers, email, doFetch);
      if (existing) return { status: 'already_registered', verified: existing.verified };
      const reason = body.errors?.map((e) => e.message).filter(Boolean).join('; ') || `Cloudflare answered ${res.status}`;
      return { status: 'failed', reason };
    } catch (e) {
      return { status: 'failed', reason: e instanceof Error ? e.message : 'request failed' };
    }
  };
}

async function findDestination(url: string, headers: Record<string, string>, email: string, doFetch: typeof fetch) {
  try {
    const res = await doFetch(`${url}?per_page=50`, { headers });
    if (!res.ok) return null;
    const body = (await res.json()) as CfResponse;
    const hit = body.result?.find((a) => a.email?.toLowerCase() === email);
    return hit ? { verified: Boolean(hit.verified) } : null;
  } catch {
    return null;
  }
}
