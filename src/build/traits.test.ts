import { describe, it, expect } from 'vitest';
import { buildingTraits } from './traits';
import type { BuildingCharacter } from './character';

const ch = (o: Partial<BuildingCharacter>): BuildingCharacter => ({ areas: {}, glass: 0, totalArea: 0, footprint: 9, height: 4, volume: 20, nature: 3, light: 0, size: 2, ...o });

describe('buildingTraits', () => {
  it('three rows: nature, light, size', () => {
    const t = buildingTraits(ch({ nature: 5, light: 0, size: 2 }));
    expect(t.rows.map((r) => [r.label, r.stars])).toEqual([['自然', '★★★★★'], ['灯り', 'なし'], ['大きさ', '★★☆☆☆']]);
    expect(t.rows[2].note).toBe('足元 9 マス・高さ 4 マス');
  });
  it('a lit, man-made house keeps fireflies, owls and kingfishers away', () => {
    const t = buildingTraits(ch({ nature: 1, light: 3 }));
    expect(t.away.map((a) => a.id)).toEqual(['firefly', 'owl', 'kingfisher']);
    expect(t.rows[1].note).toContain('8 マス');
  });
  it('a natural house without windows keeps no one away', () => {
    expect(buildingTraits(ch({ nature: 4, light: 0 })).away).toEqual([]);
  });
});
