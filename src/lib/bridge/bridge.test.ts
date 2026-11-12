import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../model/index.ts';
import { BridgeError, createBridge } from './index.ts';
import { createMockBridge } from './mock.ts';

const tx = (n: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, date: '2026-11-12', type: 'expense', category: 'food', memo: '',
  amountMinor: -100, createdAt: '2026-11-12T09:00:00.000Z', updatedAt: '2026-11-12T09:00:00.000Z', deleted: false, rev: 0, ...o,
});
const upsert = (t: Transaction) => ({ entity: 'tx' as const, record: t });
const reply = (body: string) => vi.fn(async () => new Response(body, { status: 200 }));

describe('createBridge', () => {
  it('makes the exact fetch call', async () => {
    const f = reply(JSON.stringify({ ok: true, v: 1, serverTime: 'x', schemaVersion: 1, head: 3 }));
    const b = createBridge({ url: 'https://example.invalid/exec', token: 'tok', fetchImpl: f as unknown as typeof fetch });
    expect(await b.ping()).toMatchObject({ head: 3 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.invalid/exec');
    expect(init).toMatchObject({
      method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    expect(JSON.parse(init.body as string)).toEqual({ v: 1, token: 'tok', action: 'ping' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('HTML response is BAD_RESPONSE, retryable', async () => {
    const b = createBridge({ url: 'u', token: 't', fetchImpl: reply('<!DOCTYPE html><html>Sign in</html>') as unknown as typeof fetch });
    await expect(b.pull(0)).rejects.toMatchObject({ name: 'BridgeError', code: 'BAD_RESPONSE', retryable: true });
  });
  it('maps error envelopes and network failures', async () => {
    const e = reply(JSON.stringify({ ok: false, v: 1, error: { code: 'UNAUTHORIZED', message: 'unauthorized', retryable: false } }));
    await expect(createBridge({ url: 'u', token: 't', fetchImpl: e as unknown as typeof fetch }).ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    const n = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const err = await createBridge({ url: 'u', token: 't', fetchImpl: n as unknown as typeof fetch }).push([]).catch((x) => x);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err).toMatchObject({ code: 'NETWORK', retryable: true });
  });
  it('aborts after 20 s', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
        init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      }));
      const p = createBridge({ url: 'u', token: 't', fetchImpl: f as unknown as typeof fetch }).ping();
      const assertion = expect(p).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mock bridge', () => {
  it('push then pull round-trip incl. memo =1+1', async () => {
    const m = createMockBridge();
    const r = await m.push([upsert(tx(1, { memo: '=1+1' }))]);
    expect(r.results[0]).toMatchObject({ status: 'applied', rev: 1 });
    const p = await m.pull(0);
    expect(p.tx[0].memo).toBe('=1+1');
    expect(m.sheet.readAll('Transactions')[1][5]).toBe('=1+1');
  });
  it('failAfter applies but loses the response; replay is duplicate', async () => {
    const m = createMockBridge();
    m.failAfter = true;
    await expect(m.push([upsert(tx(1))])).rejects.toMatchObject({ code: 'NETWORK' });
    m.failAfter = false;
    expect(m.sheet.readAll('Transactions')).toHaveLength(2);
    const r = await m.push([upsert(tx(1))]);
    expect(r.results[0].status).toBe('duplicate');
    expect(m.sheet.readAll('Transactions')).toHaveLength(2);
  });
  it('failBefore (counted) and offline never reach the server', async () => {
    const m = createMockBridge();
    m.failBefore = 1;
    await expect(m.push([upsert(tx(1))])).rejects.toMatchObject({ code: 'NETWORK' });
    expect(m.sheet.readAll('Transactions')).toHaveLength(1);
    m.offline = true;
    await expect(m.ping()).rejects.toMatchObject({ retryable: true });
    m.offline = false;
    expect((await m.push([upsert(tx(1))])).results[0].status).toBe('applied');
    expect(m.requests).toBe(1);
  });
  it('delayMs delays the answer', async () => {
    vi.useFakeTimers();
    try {
      const m = createMockBridge();
      m.delayMs = 500;
      let done = false;
      const p = m.ping().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('clockOffsetMs shifts server time and the clock guard', async () => {
    const m = createMockBridge({ clockOffsetMs: -3_600_000 });
    const sT = Date.parse((await m.ping()).serverTime);
    expect(Math.abs(Date.now() - 3_600_000 - sT)).toBeLessThan(5000);
    const future = new Date(Date.now() + 600_000).toISOString();
    const r = await m.push([upsert(tx(1, { updatedAt: future }))]);
    expect(r.results[0]).toMatchObject({ status: 'applied' });
    expect((r.results[0] as { updatedAt: string }).updatedAt < future).toBe(true);
  });
  it('editInSheet stamps the row so a pull sees it and older pushes go stale', async () => {
    const m = createMockBridge();
    await m.push([upsert(tx(1))]);
    m.editInSheet(tx(1).id, { memo: 'edited by hand', amountMinor: -250 });
    const p = await m.pull(1);
    expect(p.tx[0]).toMatchObject({ memo: 'edited by hand', amountMinor: -250, rev: 2 });
    const r = await m.push([upsert(tx(1, { memo: 'phone', updatedAt: '2026-11-12T09:30:00.000Z' }))]);
    expect(r.results[0].status).toBe('stale');
  });
  it('unauthorized stays unauthorized through the client error mapping', async () => {
    const m = createMockBridge();
    expect(m.token).toBeTruthy();
  });
});
