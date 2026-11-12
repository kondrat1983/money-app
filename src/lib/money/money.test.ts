import { describe, expect, it } from 'vitest'
import { formatMinor, parseAmountInput, signFor, sumMinor } from './index'

const NBSP = ' '

describe('parseAmountInput', () => {
  it.each([
    ['420', 42000],
    ['420.5', 42050],
    ['420,50', 42050],
    ['420.50', 42050],
    ['0,05', 5],
    [',5', 50],
    ['420.', 42000],
    ['0', 0],
  ])('parses %j as %i', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected)
  })

  it('discards the sign and returns the magnitude', () => {
    expect(parseAmountInput('-420,50')).toBe(42050)
    expect(parseAmountInput('+420,50')).toBe(42050)
    expect(parseAmountInput('−420,50')).toBe(42050)
  })

  it('ignores spaces of every kind, including NBSP and narrow NBSP', () => {
    expect(parseAmountInput('-20 002')).toBe(2000200)
    expect(parseAmountInput(`-20${NBSP}002`)).toBe(2000200)
    expect(parseAmountInput('20 002,00')).toBe(2000200)
    expect(parseAmountInput('  1 234 567,89  ')).toBe(123456789)
    expect(parseAmountInput('20\t002')).toBe(2000200)
  })

  it('rounds beyond two decimals half-up to an integer kopiyka', () => {
    expect(parseAmountInput('0.499')).toBe(50)
    expect(parseAmountInput('0.005')).toBe(1)
    expect(parseAmountInput('0.004')).toBe(0)
    expect(parseAmountInput('420,554')).toBe(42055)
    expect(parseAmountInput('420,555')).toBe(42056)
    expect(parseAmountInput('1.999')).toBe(200)
    expect(Number.isInteger(parseAmountInput('12.3456')!)).toBe(true)
  })

  it('handles large 7-digit and 8-digit values exactly', () => {
    expect(parseAmountInput('1234567')).toBe(123456700)
    expect(parseAmountInput('12345678,9')).toBe(1234567890)
    expect(parseAmountInput('99999999.99')).toBe(9999999999)
  })

  it.each([
    'garbage',
    '',
    '   ',
    '-',
    '.',
    ',',
    '12a',
    '1,000.50',
    '1.2.3',
    '--5',
    '1e3',
    '0x10',
    '420 грн',
    'NaN',
    'Infinity',
    '9'.repeat(400),
  ])('returns null for %j', (input) => {
    expect(parseAmountInput(input)).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(parseAmountInput(42 as unknown as string)).toBeNull()
    expect(parseAmountInput(undefined as unknown as string)).toBeNull()
  })
})

describe('signFor', () => {
  it('makes expenses negative and income positive', () => {
    expect(signFor('expense', 42050)).toBe(-42050)
    expect(signFor('income', 42050)).toBe(42050)
  })

  it('makes transfers negative by default (money out) and positive when transferOut is false', () => {
    expect(signFor('transfer', 1000)).toBe(-1000)
    expect(signFor('transfer', 1000, true)).toBe(-1000)
    expect(signFor('transfer', 1000, false)).toBe(1000)
  })

  it('throws on zero, negative, or non-integer magnitudes', () => {
    expect(() => signFor('expense', 0)).toThrow(RangeError)
    expect(() => signFor('income', -5)).toThrow(RangeError)
    expect(() => signFor('transfer', 10.5)).toThrow(RangeError)
    expect(() => signFor('expense', Number.NaN)).toThrow(RangeError)
  })

  it('throws on an unknown transaction type', () => {
    expect(() => signFor('refund' as never, 100)).toThrow(RangeError)
  })
})

describe('formatMinor', () => {
  it('groups thousands with NBSP and hides zero kopiyky', () => {
    expect(formatMinor(2000200)).toBe(`20${NBSP}002`)
    expect(formatMinor(42000)).toBe('420')
    expect(formatMinor(0)).toBe('0')
  })

  it('uses a comma decimal and two-digit kopiyky when non-zero', () => {
    expect(formatMinor(42050)).toBe('420,50')
    expect(formatMinor(42005)).toBe('420,05')
    expect(formatMinor(5)).toBe('0,05')
    expect(formatMinor(1)).toBe('0,01')
  })

  it('formats 7-digit and 8-digit values', () => {
    expect(formatMinor(12345678)).toBe(`123${NBSP}456,78`)
    expect(formatMinor(1234567890)).toBe(`12${NBSP}345${NBSP}678,90`)
    expect(formatMinor(100000000)).toBe(`1${NBSP}000${NBSP}000`)
  })

  it('prefixes negatives with an ASCII hyphen-minus', () => {
    expect(formatMinor(-2000200)).toBe(`-20${NBSP}002`)
    expect(formatMinor(-42050)).toBe('-420,50')
    expect(formatMinor(-42050)).not.toContain('−')
  })

  it('adds "+" only for positive values when sign is requested', () => {
    expect(formatMinor(42050, { sign: true })).toBe('+420,50')
    expect(formatMinor(42050, { sign: false })).toBe('420,50')
    expect(formatMinor(42050)).toBe('420,50')
    expect(formatMinor(-42050, { sign: true })).toBe('-420,50')
    expect(formatMinor(0, { sign: true })).toBe('0')
  })

  it('treats -0 as zero', () => {
    expect(formatMinor(-0)).toBe('0')
  })

  it('round-trips through parseAmountInput', () => {
    for (const minor of [0, 1, 99, 100, 42050, 2000200, 123456789]) {
      expect(parseAmountInput(formatMinor(minor))).toBe(minor)
    }
  })

  it('throws on non-integer input', () => {
    expect(() => formatMinor(1.5)).toThrow(RangeError)
    expect(() => formatMinor(Number.NaN)).toThrow(RangeError)
  })
})

describe('sumMinor', () => {
  it('sums signed integers exactly', () => {
    expect(sumMinor([])).toBe(0)
    expect(sumMinor([42050, -2000200, 5])).toBe(-1958145)
    expect(sumMinor([1, 2])).toBe(3)
  })

  it('throws on non-integer elements', () => {
    expect(() => sumMinor([1, 1.5])).toThrow(RangeError)
  })

  it('throws when the sum leaves the safe-integer range', () => {
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError)
  })
})
