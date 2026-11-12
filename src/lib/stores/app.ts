// App bootstrap: wires stores, sync engine, bridge factory and triggers. ui -> app -> {stores, sync, bridge, db}.
import { createBridge } from '../bridge';
import type { DeviceSettings } from '../model';
import { createSync, installTriggers } from '../sync';
import { db, stores } from './index';
import { defaultCategories } from './defaultCategories';

export const sync = createSync({
  db,
  getBridge: async () => {
    const d = await db.getMeta<DeviceSettings>('device');
    if (!d?.bridgeUrl || !d.token) return null;
    return createBridge({ url: d.bridgeUrl, token: d.token });
  },
});

let started: Promise<void> | null = null;

export function startApp(): Promise<void> {
  return (started ??= (async () => {
    await stores.init();
    stores.attachSync(sync);
    installTriggers(sync, window);
    // After each finished run: a full pull against a Sheet without categories empties the local cache, so re-seed
    // the bundled defaults, and reload the visible lists so pulled rows show up.
    let lastSeen = sync.status.get().lastSyncAt;
    sync.status.subscribe((s) => {
      if (s.state !== 'idle' || s.lastSyncAt === lastSeen) return;
      lastSeen = s.lastSyncAt;
      void db.seedDefaultCategories(defaultCategories).then(() => stores.ledger.refresh());
    });
    stores.hooks.onSaved = () => sync.requestFlush('save');
    try {
      if ((await db.getMeta('persistGranted')) === undefined) {
        const granted = (await navigator.storage?.persist?.()) ?? false;
        await db.setMeta('persistGranted', granted);
      }
    } catch {
      /* persist() is best effort */
    }
    sync.requestFlush('start');
  })());
}
