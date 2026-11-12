// HTTP client for the Apps Script API. Contract: docs/ARCHITECTURE.md §4.
import type { Bridge, ErrorCode, Op, PingRes, PullRes, PushRes } from '../model/index.ts';
import { API_VERSION } from '../model/index.ts';

export class BridgeError extends Error {
  code: ErrorCode;
  retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface BridgeConfig {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export const REQUEST_TIMEOUT_MS = 20_000;

/** Turns a parsed envelope into its payload, or throws BridgeError. Shared with the mock. */
export function unwrapEnvelope<T>(json: unknown): T {
  if (!json || typeof json !== 'object') throw new BridgeError('BAD_RESPONSE', 'bad response', true);
  const env = json as { ok?: unknown; error?: { code?: unknown; message?: unknown; retryable?: unknown } };
  if (env.ok === true) return json as T;
  if (env.ok === false && env.error && typeof env.error.code === 'string') {
    throw new BridgeError(env.error.code as ErrorCode, String(env.error.message ?? env.error.code), env.error.retryable === true);
  }
  throw new BridgeError('BAD_RESPONSE', 'bad response', true);
}

export function createBridge(cfg: BridgeConfig): Bridge {
  const doFetch: typeof fetch = cfg.fetchImpl ?? ((...a) => globalThis.fetch(...a));

  async function call<T>(action: string, params: Record<string, unknown>): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    let text: string;
    try {
      const res = await doFetch(cfg.url, {
        method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ v: API_VERSION, token: cfg.token, action, ...params }),
        signal: ctl.signal,
      });
      text = await res.text();
    } catch {
      throw new BridgeError('NETWORK', 'network error', true);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BridgeError('BAD_RESPONSE', 'response is not JSON', true);
    }
    return unwrapEnvelope<T>(json);
  }

  return {
    ping: () => call<PingRes>('ping', {}),
    pull: (since, limit) => call<PullRes>('pull', limit === undefined ? { since } : { since, limit }),
    push: (ops: Op[]) => call<PushRes>('push', { ops }),
  };
}
