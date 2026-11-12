import { createDb } from '../db';
import { createStores } from './stores.svelte';

export { createStores } from './stores.svelte';
export type { Stores, SyncStatus, SyncLike, TxInput, TxPatch } from './stores.svelte';
export * from './derive';
export { defaultCategories } from './defaultCategories';

/** App-wide singleton on the default IndexedDB. Call `stores.init()` once at startup. */
export const stores = createStores(createDb());
