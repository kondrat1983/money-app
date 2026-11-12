// Shared data model. Contract: docs/ARCHITECTURE.md §2. Keep in sync with that file.

export type TxType = 'expense' | 'income' | 'transfer';
export const TX_TYPES: readonly TxType[] = ['expense', 'income', 'transfer'];

export interface Transaction {
  id: string; // UUID v4 lowercase
  date: string; // 'YYYY-MM-DD' local calendar date
  type: TxType;
  category: string; // Category.id (slug)
  memo: string; // '' allowed, <= 500 chars, trimmed
  amountMinor: number; // signed integer kopiyky; expense < 0, income > 0, transfer != 0
  createdAt: string; // ISO 8601 UTC with ms
  updatedAt: string; // ISO 8601 UTC with ms, conflict clock
  deleted: boolean; // tombstone
  rev: number; // server revision, 0 = never acknowledged
}

export interface Category {
  id: string; // slug, immutable
  name: string; // <= 40 chars
  kind: TxType;
  icon: string; // sprite key, unknown -> 'coin'
  color: string; // '#RRGGBB'
  order: number;
  archived: boolean;
  updatedAt: string;
  rev: number;
}

export interface RemoteSettings {
  schemaVersion: 1;
  currency: 'UAH';
  bigAmountMinor: number;
}

export interface DeviceSettings {
  bridgeUrl: string;
  token: string;
  theme: 'dark' | 'light' | 'auto';
  sound: boolean;
  haptics: boolean;
}

export type Entity = 'tx' | 'cat';
export type Op =
  | { entity: 'tx'; record: Transaction }
  | { entity: 'cat'; record: Category };

export type OpResult =
  | { entity: Entity; id: string; status: 'applied' | 'duplicate'; rev: number; updatedAt: string }
  | { entity: 'tx'; id: string; status: 'stale'; record: Transaction }
  | { entity: 'cat'; id: string; status: 'stale'; record: Category }
  | { entity: Entity; id: string; status: 'invalid'; reason: string };

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'SCHEMA_MISMATCH'
  | 'TOO_LARGE'
  | 'BUSY'
  | 'INTERNAL'
  | 'BAD_RESPONSE'
  | 'NETWORK';

export interface PingRes { schemaVersion: number; head: number; serverTime: string }
export interface PullRes {
  head: number;
  rev: number;
  more: boolean;
  tx: Transaction[];
  cat: Category[];
  settings: RemoteSettings;
  counts: { tx: number; cat: number };
  invalid: { sheet: string; row: number; reason: string }[];
  serverTime: string;
}
export interface PushRes { head: number; results: OpResult[]; serverTime: string }

export interface Bridge {
  ping(): Promise<PingRes>;
  pull(since: number, limit?: number): Promise<PullRes>;
  push(ops: Op[]): Promise<PushRes>;
}

export const API_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const MAX_OPS_PER_PUSH = 200;
export const MAX_MEMO = 500;
export const MAX_ABS_AMOUNT_MINOR = 1e11;

export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
