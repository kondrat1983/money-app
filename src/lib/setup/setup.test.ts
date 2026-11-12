import { describe, expect, it } from 'vitest';
import { makeSetupString, parseSetupString } from './index';

const URL_OK = 'https://script.google.com/macros/s/TEST/exec';

describe('setup string', () => {
  it('round-trips', () => {
    const r = parseSetupString(makeSetupString({ url: URL_OK, token: 'tok-_ab' }));
    expect(r).toEqual({ ok: true, value: { url: URL_OK, token: 'tok-_ab' } });
  });
  it('rejects bad input', () => {
    expect(parseSetupString('nope').ok).toBe(false);
    expect(parseSetupString('youspent1.@@@').ok).toBe(false);
    expect(parseSetupString(makeSetupString({ url: 'https://evil.example/x', token: 't' })).ok).toBe(false);
    expect(parseSetupString(makeSetupString({ url: URL_OK, token: '' })).ok).toBe(false);
  });
});
