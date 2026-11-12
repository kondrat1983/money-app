// The device zone is pinned to Europe/Kyiv so local-vs-UTC behaviour is deterministic.
// Node reads TZ at runtime (Node >= 13), and the sanity test below fails loudly if it did not apply.
// `process` is not in the app tsconfig types, so reach it through a narrow cast.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Kyiv'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMonths,
  monthOf,
  monthRange,
  nextIso,
  nowIso,
  parseExportDate,
  todayLocal,
} from './index'

const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('timezone setup', () => {
  it('runs with Europe/Kyiv offsets (UTC+2 in November)', () => {
    expect(new Date(2026, 10, 12, 12).getTimezoneOffset()).toBe(-120)
  })
})

describe('todayLocal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the device calendar day, not the UTC day (after local midnight, before UTC midnight)', () => {
    // 22:30 UTC on 11 Nov is 00:30 on 12 Nov in Kyiv.
    vi.setSystemTime(new Date('2026-11-11T22:30:00Z'))
    expect(todayLocal()).toBe('2026-11-12')
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-11')
  })

  it('uses the device calendar day when UTC is already on the next day', () => {
    // 22:30 UTC on 12 Nov is 00:30 on 13 Nov in Kyiv.
    vi.setSystemTime(new Date('2026-11-12T22:30:00Z'))
    expect(todayLocal()).toBe('2026-11-13')
  })

  it('returns the same day late in the evening local time', () => {
    vi.setSystemTime(new Date('2026-11-12T21:59:59Z'))
    expect(todayLocal()).toBe('2026-11-12')
  })

  it('zero-pads month and day', () => {
    vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))
    expect(todayLocal()).toBe('2026-01-09')
  })
})

describe('monthOf', () => {
  it('returns YYYY-MM for a valid date string', () => {
    expect(monthOf('2026-11-12')).toBe('2026-11')
    expect(monthOf('2026-01-01')).toBe('2026-01')
  })

  it('reads a Date in the device timezone', () => {
    // 2026-11-01 00:30 Kyiv is 2026-10-31 22:30 UTC: the local month is November.
    expect(monthOf(new Date(2026, 10, 1, 0, 30))).toBe('2026-11')
  })

  it('throws on invalid strings and dates', () => {
    expect(() => monthOf('2026-02-30')).toThrow(RangeError)
    expect(() => monthOf('2026-11')).toThrow(RangeError)
    expect(() => monthOf('nope')).toThrow(RangeError)
    expect(() => monthOf(new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe('monthRange', () => {
  it('returns string bounds with day 31 as the upper bound', () => {
    expect(monthRange('2026-11')).toEqual(['2026-11-01', '2026-11-31'])
    expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-02-31'])
    expect(monthRange('2026-12')).toEqual(['2026-12-01', '2026-12-31'])
  })

  it('brackets every real date of the month when compared as strings', () => {
    const [lo, hi] = monthRange('2028-02')
    for (const day of ['01', '14', '29']) {
      const date = `2028-02-${day}`
      expect(date >= lo && date <= hi).toBe(true)
    }
    expect('2028-03-01' > hi).toBe(true)
    expect('2028-01-31' < lo).toBe(true)
  })

  it('throws on malformed months', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError)
    expect(() => monthRange('2026-00')).toThrow(RangeError)
    expect(() => monthRange('2026-1')).toThrow(RangeError)
    expect(() => monthRange('2026-11-01')).toThrow(RangeError)
  })
})

describe('addMonths', () => {
  it('rolls December over to January of the next year', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-12', 13)).toBe('2028-01')
  })

  it('rolls January back to December of the previous year', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-01', -13)).toBe('2024-12')
  })

  it('returns the same month for n = 0 and moves within a year', () => {
    expect(addMonths('2026-11', 0)).toBe('2026-11')
    expect(addMonths('2026-03', 4)).toBe('2026-07')
    expect(addMonths('2026-11', -10)).toBe('2026-01')
  })

  it('keeps zero-padding', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09')
    expect(addMonths('2026-09', 1)).toBe('2026-10')
  })

  it('throws on invalid input', () => {
    expect(() => addMonths('2026-13', 1)).toThrow(RangeError)
    expect(() => addMonths('2026-11', 1.5)).toThrow(RangeError)
    expect(() => addMonths('2026-11', Number.NaN)).toThrow(RangeError)
    expect(() => addMonths('garbage', 1)).toThrow(RangeError)
  })
})

describe('nowIso', () => {
  it('returns the current instant as ISO UTC with milliseconds', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-12T10:15:30.123Z'))
      expect(nowIso()).toBe('2026-11-12T10:15:30.123Z')
    } finally {
      vi.useRealTimers()
    }
    expect(nowIso()).toMatch(ISO_MS_RE)
  })
})

describe('nextIso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the clock when it is ahead of prev', () => {
    vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'))
    expect(nextIso('2026-11-12T09:00:00.000Z')).toBe('2026-11-12T10:00:00.000Z')
  })

  it('is prev + 1 ms when the clock is behind prev', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    expect(nextIso('2026-06-01T00:00:00.000Z')).toBe('2026-06-01T00:00:00.001Z')
  })

  it('is strictly monotonic when the clock stands still or runs backwards', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    let prev = '2026-06-01T00:00:00.000Z'
    const seen: string[] = []
    for (let i = 0; i < 50; i++) {
      prev = nextIso(prev)
      seen.push(prev)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] > seen[i - 1]).toBe(true)
    }
    expect(seen[0]).toBe('2026-06-01T00:00:00.001Z')
    expect(seen[49]).toBe('2026-06-01T00:00:00.050Z')
  })

  it('returns a valid ISO UTC string', () => {
    expect(nextIso('2026-11-12T10:15:30.123Z')).toMatch(ISO_MS_RE)
  })
})

describe('parseExportDate', () => {
  it('pads single-digit month and day', () => {
    expect(parseExportDate('2026-1-9')).toBe('2026-01-09')
    expect(parseExportDate('2026-11-2')).toBe('2026-11-02')
    expect(parseExportDate('2026-12-31')).toBe('2026-12-31')
  })

  it('accepts whitespace around the value', () => {
    expect(parseExportDate(' 2026-1-9 ')).toBe('2026-01-09')
  })

  it('accepts leap days only in leap years', () => {
    expect(parseExportDate('2028-2-29')).toBe('2028-02-29')
    expect(() => parseExportDate('2026-2-29')).toThrow()
    expect(() => parseExportDate('2100-2-29')).toThrow()
  })

  it('throws on non-existent calendar dates', () => {
    expect(() => parseExportDate('2026-2-30')).toThrow(/invalid calendar date/)
    expect(() => parseExportDate('2026-4-31')).toThrow()
    expect(() => parseExportDate('2026-13-1')).toThrow()
    expect(() => parseExportDate('2026-0-1')).toThrow()
    expect(() => parseExportDate('2026-1-0')).toThrow()
  })

  it('throws on malformed input', () => {
    expect(() => parseExportDate('09.01.2026')).toThrow(/invalid export date/)
    expect(() => parseExportDate('2026/1/9')).toThrow()
    expect(() => parseExportDate('2026-1-9T10:00')).toThrow()
    expect(() => parseExportDate('')).toThrow()
    expect(() => parseExportDate('garbage')).toThrow()
  })
})
