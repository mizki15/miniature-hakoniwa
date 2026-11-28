// 箱庭の効果音を lumina-sfx のカタログから書き出す（public/sfx/*.ogg）。使い方：node scripts/build-sfx.mjs public/sfx [名前…]
// LUM は lumina-sfx スキルの場所。書き出したら、大きさ（ピーク）を測り直して src/audio/bank.ts の PEAK に入れる
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const LUM = 'C:/Users/NKJ-M/.claude/skills/lumina-sfx';
const DEST = process.argv[2];
const SPECS = path.resolve(process.env.TEMP ?? '.', 'hakoniwa-sfx-specs');
fs.mkdirSync(SPECS, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });
// name: 書き出す名前、base: カタログの ID（または layers）、fit: 秒、opts: remix の追加
const L = (id, o = {}) => ({ id, ...o });
const CUES = [
  ['a01', 'watering-can-rose', { fit: 0.8, nofit: 1 }],
  ['a02', 'pull-carrot-from-loam', {}],
  ['a03', 'cat-rubs-against-a-coat', { fit: 0.75, nofit: 1 }],
  ['a04', 'horse-chewing-a-carrot', { fit: 1.0, nofit: 1, pitch: 4 }],
  ['a05', [L('hatchet-greenwood'), L('hatchet-greenwood', { offsetSec: 0.3, gain: 0.9 }), L('dry-vine-brush', { offsetSec: 0.7, gain: 0.7 })]],
  ['a06', 'snap-green-stalk', {}],
  ['a07', 'cut-grain-sheaf', { fit: 0.45, nofit: 1 }],
  ['a09', 'a-page-corner-unfolded', { fit: 0.4, nofit: 1 }],
  ['b01', 'spade-turn-loam', { fit: 0.5, nofit: 1 }],
  ['b02', 'plant-large-seeds', {}],
  ['b03', [L('trowel-soft-soil'), L('hand-pat-soil', { offsetSec: 0.55, gain: 0.8 })]],
  ['b04', 'hand-pat-soil', { fit: 0.5, nofit: 1 }],
  ['b05a', 'shovel-dry-earth', { fit: 0.4, nofit: 1 }],
  ['b05b', 'stone-cairn-first-piece-gives-way', { fit: 0.45, nofit: 1 }],
  ['b05c', 'dry-sand-footstep', { fit: 0.4, nofit: 1 }],
  ['b05d', 'drive-fence-stake', { fit: 0.4, nofit: 1 }],
  ['b05e', 'bundle-dry-stalks', { fit: 0.4, nofit: 1 }],
  ['b05f', 'mud-squelch-footstep', { fit: 0.45, nofit: 1 }],
  ['b05h', 'crystal-pickup-tick', {}],
  ['b06', 'backfill-furrow', { fit: 0.5, nofit: 1 }],
  ['b07a', 'hand-pat-soil', { fit: 0.3, nofit: 1, pitch: -3 }],
  ['b07b', 'slate-tile-sliding-into-place', { fit: 0.3, nofit: 1 }],
  ['b07c', 'dune-sand-careful-toe-placement', {}],
  ['b07d', 'body-weight-set-on-a-wooden-bench', { fit: 0.35, nofit: 1 }],
  ['b07e', 'dry-vine-brush', { fit: 0.3, nofit: 1 }],
  ['b08a', 'shovel-dry-earth', { fit: 0.35, nofit: 1, pitch: -2 }],
  ['b08b', 'gravel-check-step-and-turn', { fit: 0.45 }],
  ['b08c', 'slate-tile-sliding-into-place', { fit: 0.35, nofit: 1, pitch: 2 }],
  ['b08d', 'stride-hardwood', { fit: 0.35 }],
  ['b08e', 'brick-stacked-into-a-wall', { fit: 0.35, nofit: 1 }],
  ['b10', 'drive-fence-stake', { fit: 1.0 }],
  ['b11', 'farm-fence-build-tap', { fit: 0.25, nofit: 1 }],
  ['b13', 'cards-dealt-onto-a-wooden-counter', { fit: 0.8 }],
  ['b14', 'apple-falls-in-orchard', { pitch: -7 }],
  ['b15', 'disabled-control-shallow-press', {}],
  ['b16', 'menu-blocked-double-tap', {}],
  ['b17', 'book-page-turn', { fit: 0.3, nofit: 1 }],
  ['b18', 'settings-tab-walnut-detent', {}],
  ['c04', [L('poplar-canopy-rustle-loop', { durationSec: 0.9 })]],
  ['d01', 'dry-vine-brush', { fit: 0.5 }],
  ['d04', 'grain-sack-set-off-a-shoulder', { fit: 0.5 }],
  ['d08', [L('campfire-crackle-loop', { durationSec: 2.0 })]],
  ['d10', 'stride-grass', { fit: 0.15, nofit: 1, pitch: 7 }],
  ['d11', 'inventory-item-lift', {}],
  ['d12', 'parcel-set-inside-a-delivery-box', { fit: 0.5 }],
  ['d13', 'mallard-slips-into-pond-water', { fit: 0.5, nofit: 1 }],
  ['e06', 'soft-air-match-cut', {}],
  ['f01', 'coin-counter-deposit-accept', {}],
  ['f03', 'jacket-movement-rustle', { fit: 0.5 }],
  ['f04', 'jar-cooling-seal-pop', { fit: 0.12, nofit: 1, pitch: 5 }],
  ['f05', 'field-satchel-buckle-release', {}],
  ['f06', 'field-journal-covers-close', {}],
  ['f07', 'desktop-mouse-press', {}],
  ['f08', 'small-door-latch-close', {}],
  ['f09', 'menu-confirm-pluck', {}],
  ['f11', 'menu-item-snaps-into-a-slot', {}],
  ['f13', 'settings-apply-overcentre-latch', {}],
  // 環境音のループ
  ['amb-wind', 'dry-grass-wind-loop', { loop: true }],
  ['amb-stream', 'trickle-into-irrigation-loop', { loop: true }],
  ['amb-rain', 'rain-in-leaves-loop', { loop: true }],
  ['amb-birds', 'dry-stone-wall-in-farmland-loop', { loop: true }],
  ['amb-dawn', 'robin-singing-over-a-brook-loop', { loop: true }],
  ['amb-night', 'autumn-meadow-edge-after-dusk-loop', { loop: true }],
  ['amb-frogs', 'marsh-frogs-night-loop', { loop: true }],
  ['amb-leaves', 'poplar-canopy-rustle-loop', { loop: true }],
];
const only = process.argv.slice(3);
const credits = {};
for (const [name, base, o = {}] of CUES) {
  if (only.length && !only.includes(name)) continue;
  const id = `hk-${name}`;
  const args = ['scripts/remix.mjs'];
  if (Array.isArray(base)) {
    const spec = { id, layers: base, macros: { space: 'outdoor_open', wetness: o.loop ? 0 : 0.12 } };
    const f = path.join(SPECS, `${name}.json`);
    fs.writeFileSync(f, JSON.stringify(spec, null, 2));
    args.push('--spec', f);
  } else {
    args.push(base, '--id', id);
    if (!o.loop) args.push('--space', 'outdoor_open', '--wetness', '0.12');
  }
  if (o.fit && !o.nofit) args.push('--fit-seconds', String(o.fit));
  if (o.pitch) args.push(`--pitchShift=${o.pitch}`);
  args.push('--format', 'ogg', '--dest', DEST);
  let r;
  try { r = JSON.parse(execFileSync('node', args, { cwd: LUM, encoding: 'utf8' }).trim().split('\n').pop()); }
  catch (e) { r = { pass: false, error: String(e.stdout || e.message).slice(-300) }; }
  if (r.pass) {
    const out = path.join(DEST, `${name}.ogg`);
    fs.renameSync(r.file, out);
    credits[name] = r.credits;
    console.log('ok', name, fs.statSync(out).size);
  } else console.log('FAIL', name, r.error);
}
const cf = path.join(DEST, 'credits.json');
const old = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
fs.writeFileSync(cf, JSON.stringify({ ...old, ...credits }, null, 1));
