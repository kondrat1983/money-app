import type { Category, TxType } from '../model';

const SEED_AT = '1970-01-01T00:00:00.000Z';

// [id, name, icon, color]
type Row = [string, string, string, string];

const EXPENSE: Row[] = [
  ['food', 'Food', 'food', '#B8860B'],
  ['pizza', 'Pizza', 'pizza', '#C9692E'],
  ['snacks', 'Snacks', 'cookie', '#A8742F'],
  ['fruits', 'Fruits', 'apple', '#7C9A3C'],
  ['wine', 'Wine', 'wine', '#8E2F4A'],
  ['transportation', 'Transportation', 'bus', '#5B7FA6'],
  ['utilities', 'Utilities', 'bolt', '#D0A03A'],
  ['internet', 'Internet', 'wifi', '#4F8FA3'],
  ['telephone', 'Telephone', 'phone', '#6E7FA8'],
  ['subscriptions', 'Subscriptions', 'scroll', '#B8860B'],
  ['bank-fees', 'Bank fees', 'bank', '#8A8478'],
  ['home', 'Home', 'home', '#9A6B3F'],
  ['electronics', 'Electronics', 'chip', '#5E8F8A'],
  ['clothing', 'Clothing', 'shirt', '#7E6BA8'],
  ['health', 'Health', 'heart', '#B8443C'],
  ['gift', 'Gift', 'gift', '#C2547A'],
  ['family', 'Family', 'family', '#C98A4B'],
  ['donations', 'Donations', 'hand', '#6FA07A'],
  ['games', 'Games', 'gamepad', '#6F6FC9'],
  ['entertainment', 'Entertainment', 'mask', '#A85C9A'],
  ['atm', 'ATM', 'atm', '#7D8A5C'],
  ['cigarettes', 'Cigarettes', 'smoke', '#8A7F72'],
  ['filter', 'Filter', 'filter', '#8A7F72'],
  ['books', 'Books', 'book', '#8C6A3A'],
  ['education', 'Education', 'cap', '#4F7FA3'],
  ['football', 'Football', 'ball', '#5B9A5B'],
  ['arcade', 'Arcade', 'joystick', '#B84C8A'],
  ['others', 'Others', 'coin', '#8A8478'],
];

const INCOME: Row[] = [
  ['salary', 'Salary', 'coin', '#6F95C9'],
  ['refunds', 'Refunds', 'undo', '#5B9AA6'],
  ['others-income', 'Others', 'coin', '#8A8478'],
];

const TRANSFER: Row[] = [['savings', 'Savings', 'chest', '#D0A03A']];

function build(rows: Row[], kind: TxType, startOrder: number): Category[] {
  return rows.map(([id, name, icon, color], i) => ({
    id,
    name,
    kind,
    icon,
    color,
    order: startOrder + i * 10,
    archived: false,
    updatedAt: SEED_AT,
    rev: 0,
  }));
}

/** Bundled seed used on first run (not queued for sync). Same slugs as the Sheet seed. */
export const defaultCategories: Category[] = [
  ...build(EXPENSE, 'expense', 10),
  ...build(INCOME, 'income', 1000),
  ...build(TRANSFER, 'transfer', 2000),
];
