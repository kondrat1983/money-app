<script lang="ts">
  import type { Category, TxType } from '../../lib/model';
  import SpentCard from '../overlay/SpentCard.svelte';
  import EntrySheet from './EntrySheet.svelte';

  const exp = ['Food:food', 'Pizza:pizza', 'Snacks:snacks', 'Fruits:fruits', 'Wine:wine', 'Transportation:bus', 'Utilities:bolt', 'Internet:wifi', 'Telephone:phone', 'Subscriptions:scroll', 'Bank fees:bank', 'Home:home', 'Electronics:chip', 'Clothing:shirt', 'Health:heart-plus', 'Gift:gift', 'Family:family', 'Donations:heart', 'Games:gamepad', 'Entertainment:mask', 'ATM:atm', 'Cigarettes:cigarette', 'Filter:filter', 'Books:book', 'Education:cap', 'Football:ball', 'Arcade:joystick', 'Others:coin'];
  const inc = ['Salary:salary', 'Refunds:refund', 'Others:coin'];
  const mk = (kind: TxType, list: string[]): Category[] =>
    list.map((s, order) => {
      const [name, icon] = s.split(':');
      return { id: `${kind}-${name.toLowerCase()}`, name, kind, icon, color: '#888888', order, archived: false, updatedAt: '', rev: 0 };
    });
  const categories = [...mk('expense', exp), ...mk('income', inc)];
  const recentIds: Record<TxType, string[]> = { expense: ['expense-pizza', 'expense-food', 'expense-transportation'], income: [], transfer: [] };

  let open = $state(false);
  let event = $state<{ type: TxType; amountMinor: number; big: boolean; key: number } | null>(null);
  let key = 0;
  let last = $state('');

  function save(i: { type: TxType; amountMinor: number; category: string; memo: string; date: string }) {
    last = JSON.stringify(i);
    event = { type: i.type, amountMinor: i.amountMinor, big: Math.abs(i.amountMinor) >= 500000, key: ++key };
  }
</script>

<div class="frame">
  <button class="fab" type="button" onclick={() => (open = true)}>+</button>
  <pre>{last}</pre>
  <EntrySheet {open} {categories} {recentIds} onSave={save} onClose={() => (open = false)} />
  <SpentCard {event} onDone={() => (event = null)} />
</div>

<style>
  .frame {
    position: relative;
    width: 100%;
    max-width: 390px;
    height: 100dvh;
    max-height: 844px;
    margin: 0 auto;
    overflow: hidden;
    background: var(--bg);
  }
  .fab {
    position: absolute;
    left: 50%;
    bottom: 28px;
    width: 70px;
    height: 70px;
    margin-left: -35px;
    border-radius: 50%;
    border: 2px solid var(--amber);
    background: var(--bg2);
    color: var(--amber);
    font-size: 32px;
  }
  pre {
    color: var(--ink3);
    font-size: 11px;
    white-space: pre-wrap;
    padding: 16px;
  }
</style>
