// Setup string: `youspent1.<base64url(JSON {u, t})>`. Contract: docs/ARCHITECTURE.md §5.
export interface SetupValues {
  url: string;
  token: string;
}

export const SETUP_PREFIX = 'youspent1.';
const ALLOWED_HOST = 'script.google.com';

/** Validates a bridge URL: https, script.google.com (the only host the CSP allows). Returns an error text or null. */
export function checkBridgeUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'The URL is not valid.';
  }
  if (u.protocol !== 'https:' || u.hostname !== ALLOWED_HOST) return `The URL must start with https://${ALLOWED_HOST}/`;
  return null;
}

export function parseSetupString(input: string): { ok: true; value: SetupValues } | { ok: false; error: string } {
  const s = input.trim();
  if (!s.startsWith(SETUP_PREFIX)) return { ok: false, error: 'Not a setup string (it starts with "youspent1.").' };
  let json: unknown;
  try {
    const b64 = s.slice(SETUP_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return { ok: false, error: 'The setup string is damaged. Copy it again.' };
  }
  const o = json as { u?: unknown; t?: unknown } | null;
  if (!o || typeof o.u !== 'string' || typeof o.t !== 'string' || !o.t.trim()) {
    return { ok: false, error: 'The setup string is missing the URL or the token.' };
  }
  const bad = checkBridgeUrl(o.u.trim());
  if (bad) return { ok: false, error: bad };
  return { ok: true, value: { url: o.u.trim(), token: o.t.trim() } };
}

export function makeSetupString(v: SetupValues): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ u: v.url, t: v.token }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return SETUP_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
