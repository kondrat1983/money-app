import { describe, expect, it } from 'vitest';
import { ICON_KEYS, RAW_SPRITES, normalize, spritePaths } from './sprites';

const REQUIRED = ['food', 'pizza', 'snacks', 'fruits', 'wine', 'bus', 'bolt', 'wifi', 'phone', 'scroll', 'bank', 'home', 'chip', 'shirt', 'heart-plus', 'gift', 'family', 'heart', 'gamepad', 'mask', 'atm', 'cigarette', 'filter', 'book', 'cap', 'ball', 'joystick', 'coin', 'salary', 'refund', 'chest'];

describe('sprites', () => {
  it('has every required key', () => {
    for (const k of REQUIRED) expect(ICON_KEYS, k).toContain(k);
  });
  for (const key of Object.keys(RAW_SPRITES)) {
    it(`${key} is 16x16 with valid palette chars`, () => {
      const raw = RAW_SPRITES[key];
      expect(raw.rows.length).toBeLessThanOrEqual(16);
      for (const r of raw.rows) expect(r.length).toBeLessThanOrEqual(16);
      const n = normalize(raw);
      expect(n.rows).toHaveLength(16);
      for (const r of n.rows) {
        expect(r).toHaveLength(16);
        for (const ch of r) expect('.oh' + Object.keys(raw.colors).join('')).toContain(ch);
      }
      for (const c of Object.values(raw.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spritePaths(key).length).toBeGreaterThan(0);
    });
  }
  it('falls back to coin', () => {
    expect(spritePaths('nope')).toEqual(spritePaths('coin'));
  });
});
