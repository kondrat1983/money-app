// 16x16 pixel sprites. Rows are strings, '.' is transparent, 'o' outline, 'h' highlight,
// 'a' 'b' 'c' come from the per-sprite palette. Short rows/maps are padded to 16x16 by `normalize`.
export const OUTLINE = '#0d0907';
export const HIGHLIGHT = '#f1e6cc';

export interface Sprite {
  colors: Record<string, string>;
  rows: string[];
}

export const RAW_SPRITES: Record<string, Sprite> = {
  food: {
    colors: { a: '#b5683a', b: '#8a4524', c: '#d9cdb3' },
    rows: ['................', '.........oooo...', '.......ooaaaao..', '......oaahhaaao.', '.....oaaaaaaaabo', '.....oaaaaaaabo.', '.....oaaaaaabo..', '......oaaaabo...', '.....oobbbbo....', '....occoooo.....', '...occco........', '...occco........', '....ooo.........'],
  },
  pizza: {
    colors: { a: '#d6a23a', b: '#a63a2e', c: '#a8692f' },
    rows: ['................', '.occccccccccco..', '.occccccccccco..', '..oaaaaaaaaaao..', '..oabbaaaabbao..', '..oabbaaaabbao..', '...oaaaabaaao...', '...oaaabbaaao...', '....oaaaabao....', '....oabaaaao....', '.....oaaaao.....', '.....oaabao.....', '......oaao......', '.......oo.......'],
  },
  snacks: {
    colors: { a: '#c9763a', b: '#8a4a24', c: '#e9c25a' },
    rows: ['................', '..oooooooooooo..', '.oaoaoaoaoaoaao.', '..oaaaaaaaaaao..', '..oaaccccccaao..', '..oaaccaaccaao..', '..oaaccccccaao..', '..oaaaccccaabo..', '..oaaaaaaaaabo..', '..obaaaaaaaabo..', '.oaoaoaoaoaobao.', '..oooooooooooo..'],
  },
  fruits: {
    colors: { a: '#b8443c', b: '#7e2824', c: '#5f7a3a' },
    rows: ['.........o......', '........oco.....', '.....oo.oo......', '...ooaaoaaoo....', '..oaahaaaaaao...', '.oaahaaaaaaaao..', '.oaaaaaaaaaaao..', '.oaaaaaaaaaabo..', '.oaaaaaaaaabbo..', '..oaaaaaaabbo...', '...obaaaabbo....', '....ooooooo.....'],
  },
  wine: {
    colors: { a: '#cfd6d4', b: '#8a2a33' },
    rows: ['...oooooooooo...', '...oaaaaaaaao...', '...oabbbbbbao...', '...oabbbbbbao...', '....oabbbbao....', '....oabbbbao....', '.....oaaaao.....', '......oaao......', '......oaao......', '......oaao......', '.....oooooo.....', '....oaaaaaao....', '....oooooooo....'],
  },
  bus: {
    colors: { a: '#c79a38', b: '#3b4f6b', c: '#6b5420' },
    rows: ['................', '..oooooooooooo..', '.oaaaaaaaaaaaao.', '.oabbbabbbabbbo.', '.oabbbabbbabbbo.', '.oaaaaaaaaaaaao.', '.oahhaaaaaahhao.', '.oaaaaaaaaaaaao.', '.occcccccccccco.', '.oooooooooooooo.', '..obbo....obbo..', '..obbo....obbo..', '...oo......oo...'],
  },
  bolt: {
    colors: { a: '#d9b440', b: '#a8812a', c: '#e9d27a' },
    rows: ['.........oooo...', '........oaaao...', '.......oaaao....', '......oaaao.....', '.....oaaaaaooo..', '....oaahaaaaao..', '.....ooooaaabo..', '........oaabo...', '.......oaabo....', '......oabo......', '......obo.......', '.......o........'],
  },
  wifi: {
    colors: { a: '#6f95c9', b: '#3f6399', c: '#d0a03a' },
    rows: ['................', '....oooooooo....', '..ooaaaaaaaaoo..', '.oaabbbbbbbbaao.', 'oaabboooooobbaao', 'oabboaaaaaaobbao', '.oboabbbbbbaobo.', '..ooabboobbao...', '....obaaaabo....', '.....ooaaoo.....', '......oaabo.....', '.....oaccabo....', '......obbo......', '.......oo.......'],
  },
  phone: {
    colors: { a: '#5a6577', b: '#2f4a63', c: '#d0a03a' },
    rows: ['................', '....oooooooo....', '...oaaaaaaaao...', '...oabbbbbbao...', '...oabbhbbbao...', '...oabbbbbbao...', '...oabbbbbbao...', '...oabbbbbbao...', '...oaaaaaaaao...', '...oaaaccaaao...', '...oaaaccaaao...', '...oaaaaaaaao...', '....oooooooo....'],
  },
  scroll: {
    colors: { a: '#d9cdb3', b: '#a8946a', c: '#8a3a34' },
    rows: ['................', '..oooooooooooo..', '.oaaaaaaaaaaaao.', '.obaaaaaaaaaabo.', '..oabbbbbbbbao..', '..oacccccccaao..', '..oaaaaaaaaaao..', '..oacccccccaao..', '..oaaaaaaaaaao..', '..oacccccaaaao..', '..oaaaaaaaaaao..', '.obaaaaaaaaaabo.', '.oaaaaaaaaaaaao.', '..oooooooooooo..'],
  },
  bank: {
    colors: { a: '#c8b78a', b: '#8a7d68', c: '#d0a03a' },
    rows: ['.......oo.......', '......oaao......', '....ooaaaaoo....', '..ooaaaaaaaaoo..', '.ooooooooooooo..', '..oabaoabaoabo..', '..oabaoabaoabo..', '..oabaoabaoabo..', '..oabaoabaoabo..', '..oabaoabaoabo..', '.oooooooooooooo.', '.oaaaaaaaaaaaao.', '.oooooooooooooo.'],
  },
  home: {
    colors: { a: '#a8453a', b: '#b59a72', c: '#5a3a22' },
    rows: ['.......oo.......', '......oaao......', '.....oaaaao.....', '....oaaaaaao....', '...oaaaaaaaao...', '..oaaaaaaaaaao..', '.oooooooooooooo.', '..obbbbbbbbbbo..', '..obbbooobbbbo..', '..obbboccobbbo..', '..obbboccobbbo..', '..oooooooooooo..'],
  },
  chip: {
    colors: { a: '#3f6b4a', b: '#26402d', c: '#c8b78a' },
    rows: ['................', '..o..o..o..o....', '..c..c..c..c....', '..oooooooooooo..', '.coaaaaaaaaaaoc.', '..oabbbbbbbbao..', '.coabhhhhhhbaoc.', '..oabhaaaabbao..', '.coabhaaaabbaoc.', '..oabbbbbbbbao..', '.coaaaaaaaaaaoc.', '..oooooooooooo..', '..c..c..c..c....', '..o..o..o..o....'],
  },
  shirt: {
    colors: { a: '#4f6f9a', b: '#34496a', c: '#d9cdb3' },
    rows: ['................', '...ooo....ooo...', '..oaaaoooooaao..', '.oaaaaaccccaaao.', '.oaaaaaaaaaaaao.', '.oooaaaaaaaaooo.', '...oaahaaaabo...', '...oaaaaaaabo...', '...oaaaaaaabo...', '...oaaaaaaabo...', '...obbbbbbbbo...', '....oooooooo....'],
  },
  'heart-plus': {
    colors: { a: '#b8443c', b: '#7e2824', c: '#e9dfc8' },
    rows: ['................', '...ooo....ooo...', '..oaaaoooaaao...', '.oaahaaaaaaaao..', '.oaaaaacaaaaao..', '.oaaaaacaaaabo..', '.oaaaccccaaabo..', '..oaaaacaaabo...', '...oaaacaabo....', '....oaaaabo.....', '.....oaabo......', '......obo.......', '.......o........'],
  },
  gift: {
    colors: { a: '#6a4f8a', b: '#4a3866', c: '#d0a03a' },
    rows: ['....oooo..oooo..', '...occcooccco...', '...occo..occo...', '.oooooooooooooo.', '.oaaaaacaaaaaao.', '.oooooocoooooo..', '.oaaaaacaaaaao..', '.oaaaaacaaaaao..', '.obbbbbcbbbbbo..', '.obbbbbcbbbbbo..', '.oooooooooooooo.'],
  },
  family: {
    colors: { a: '#d8b48a', b: '#6a5a8c', c: '#8a4f2c' },
    rows: ['................', '...oooo.........', '..occcco..oooo..', '..oaaaao.occcco.', '..oaaaao.oaaaao.', '...oooo...oooo..', '..obbbbbo.obbbo.', '.obbbbbbbobbbbbo', '.obbbbbbbobbbbbo', '.obbbbbbbobbbbbo', '.ooobbboooooooo.', '...obbbo........', '...oooooo.......'],
  },
  heart: {
    colors: { a: '#b8443c', b: '#7e2824' },
    rows: ['................', '................', '...oooo..oooo...', '..oaaaaooaaaao..', '.oaahhaaaaaaaao.', '.oaahaaaaaaaaao.', '.oaaaaaaaaaaaao.', '.oaaaaaaaaaaabo.', '..oaaaaaaaaabo..', '...oaaaaaaabo...', '....oaaaaabo....', '.....oaaabo.....', '......oabo......', '.......oo.......'],
  },
  gamepad: {
    colors: { a: '#6c6a78', b: '#e0d4b8', c: '#b8443c' },
    rows: ['................', '................', '...oooooooooo...', '..oaaaaaaaaaao..', '.oaaabaaaaaaaao.', '.oaabbbaaacaaao.', '.oaaabaaacacaao.', '.oaaaaaaaacaaao.', '.oaaaaaaaaaaaao.', '.oaaoooooooooao.', '.oaoo......ooao.', '..oo........oo..'],
  },
  mask: {
    colors: { a: '#d9cdb3', b: '#8a3a34', c: '#2a1f18' },
    rows: ['................', '..oooooooooooo..', '.oaaaaaaaaaaaao.', '.oaaaaaaaaaaaao.', '.oaaccaaaaccaao.', '.oaacccaaacccao.', '.oaaccaaaaccaao.', '.oaaaaaaaaaaaao.', '..oaaaoooaaaao..', '..oabbbbbbbbao..', '...oabbbbbbao...', '....oabbbbao....', '.....oooooo.....'],
  },
  atm: {
    colors: { a: '#7a8aa6', b: '#2a2f3a', c: '#d0a03a' },
    rows: ['................', '..oooooooooooo..', '.oaaaaaaaaaaaao.', '.oabbbbbbbbbbao.', '.oabbhbbbbbbbao.', '.oabbbbbbbbbbao.', '.oaaaaaaaaaaaao.', '.oaaccccccccaao.', '.oaaooooooooaao.', '.oaaaaaaaaaaaao.', '.oaacccaaaaaaao.', '.oaaaaaaaaaaaao.', '.oooooooooooooo.'],
  },
  cigarette: {
    colors: { a: '#e9dfc8', b: '#c9763a', c: '#8a7d68' },
    rows: ['................', '..............o.', '.............oc.', '..............c.', '..............o.', '................', '.oooooooooooooo.', '.obbbbaaaaaaaao.', '.obbbbaaaaaaaao.', '.oooooooooooooo.', '................', '.ccc.cc.........', '..cc..cc........'],
  },
  filter: {
    colors: { a: '#7a8aa6', b: '#3f4a5e', c: '#d0a03a' },
    rows: ['................', '.oooooooooooooo.', '.oaaaaaaaaaaaao.', '..oabbbbbbbbao..', '...oabbbbbbao...', '....oabbbbao....', '.....oabbao.....', '.....oabbao.....', '.....oabbao.....', '.....oaccao.....', '.....oaaaao.....', '......oooo......'],
  },
  book: {
    colors: { a: '#8a3a34', b: '#3b5a7a', c: '#c8b78a' },
    rows: ['................', '.oooooooooooooo.', '.oaaaaaaahaaaao.', '.oooooooooooooo.', '..occccccchcco..', '..oooooooooooo..', '.obbbbbbbbbbbbo.', '.obbbhbbbbbbbbo.', '.oooooooooooooo.'],
  },
  cap: {
    colors: { a: '#2a2f3a', b: '#4a5568', c: '#d0a03a' },
    rows: ['................', '.......oo.......', '.....ooaaoo.....', '...ooaaaaaaoo...', '.ooaaaabbaaaaoo.', 'oaaaaabbbbaaaaao', '.ooaaaaaaaaaaoo.', '...oooaaaaooo...', '...oabooooabo...', '...oabbbbbabo...', '...oabbbbbabo...', '....oooooooo....', '..........oc....', '..........oc....', '.........occo...'],
  },
  ball: {
    colors: { a: '#e9dfc8', b: '#2a2f3a', c: '#a89c84' },
    rows: ['................', '.....oooooo.....', '...ooaaaaaaoo...', '..oaaaabbaaaao..', '..oaabbbbbbaao..', '.oaaabbbbbbaaao.', '.oabbbaaaabbbao.', '.oaabaaaaaabaao.', '.oaaaaaaaaaaaco.', '..oaabaaaabaco..', '..oaabbbbbbaco..', '...ooaabbaacoo..', '.....oooooo.....'],
  },
  joystick: {
    colors: { a: '#b8443c', b: '#5a5648', c: '#2a2f3a' },
    rows: ['................', '.....oooo.......', '....oaahao......', '....oaaaao......', '.....oaao.......', '.....obbo.......', '.....obbo.......', '..oooooooooooo..', '.obbbbbbbbbbbbo.', '.obaabbbbbbaabo.', '.obaabbbbbbaabo.', '.obbbbbbbbbbbbo.', '.oooooooooooooo.'],
  },
  coin: {
    colors: { a: '#d0a03a', b: '#8e6a1e', c: '#a07818' },
    rows: ['................', '.....oooooo.....', '...ooaaaaaaoo...', '..oaahhhaaaaao..', '.oaahaaccaaaabo.', '.oaahacaaaaaabo.', '.oaaaaacccaaabo.', '.oaaaaaaaacabbo.', '.oaaaacaaacabbo.', '.oaaaaacccaabbo.', '..obaaaaaaabbo..', '...oobbbbbboo...', '.....oooooo.....'],
  },
  salary: {
    colors: { a: '#a07a3a', b: '#6a4f22', c: '#e9d27a' },
    rows: ['................', '......oooo......', '.....obaabo.....', '......oooo......', '.....oaaaao.....', '...ooaaaaaaoo...', '..oaaaaccaaaao..', '.oaaaaaccaaaaao.', '.oaaaaccccaaabo.', '.oaaaaaccaaaabo.', '.oaaaaaccaaaabo.', '.obaaaaaaaaabbo.', '..obbbbbbbbbbo..', '...oooooooooo...'],
  },
  refund: {
    colors: { a: '#6f95c9', b: '#3f6399', c: '#d0a03a' },
    rows: ['................', '.....oooooo.....', '...ooaaaaaaoo...', '..oaaaaaaaaaao..', '.oaaaoooooaaaao.', '.oaaoaaaaaoaaao.', '.oaoaaaaaaaaaao.', '.oaoooooaaaaaao.', '.oaaaooaaaaaabo.', '.obaaaaoaaaabbo.', '..obaaaaaaabbo..', '...oobbbbbboo...', '.....oooooo.....'],
  },
  chest: {
    colors: { a: '#8a5a2a', b: '#5a3a1a', c: '#d0a03a' },
    rows: ['................', '...oooooooooo...', '..oaaaaaaaaaao..', '.oaabaabaabaaao.', '.oaaaaaaaaaaaao.', '.occcccccccccco.', '.oaaaaaccaaaaao.', '.obbbbbcocbbbbo.', '.obbbbbccbbbbbo.', '.obbbbbbbbbbbbo.', '.obbbbbbbbbbbbo.', '.oooooooooooooo.'],
  },
};

export const ICON_KEYS: string[] = Object.keys(RAW_SPRITES);

/** Pads every sprite to exactly 16x16. */
export function normalize(s: Sprite): Sprite {
  const rows = s.rows.map((r) => r.padEnd(16, '.'));
  while (rows.length < 16) rows.push('.'.repeat(16));
  return { colors: s.colors, rows };
}

const cache = new Map<string, { fill: string; d: string }[]>();

/** SVG path runs grouped by color, in a 16x16 viewBox. Unknown keys fall back to 'coin'. */
export function spritePaths(key: string): { fill: string; d: string }[] {
  const k = RAW_SPRITES[key] ? key : 'coin';
  const hit = cache.get(k);
  if (hit) return hit;
  const s = normalize(RAW_SPRITES[k]);
  const by: Record<string, string[]> = {};
  s.rows.forEach((row, y) => {
    let x = 0;
    while (x < 16) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      const start = x;
      while (x < 16 && row[x] === ch) x++;
      const fill = ch === 'o' ? OUTLINE : ch === 'h' ? HIGHLIGHT : s.colors[ch];
      (by[fill] ??= []).push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  const out = Object.entries(by).map(([fill, parts]) => ({ fill, d: parts.join('') }));
  cache.set(k, out);
  return out;
}
