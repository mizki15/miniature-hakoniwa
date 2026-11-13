import { describe, it, expect } from 'vitest';
import { seasonAt } from './calendar';

describe('seasonAt progress', () => {
  it('goes from 0 at the start of the month to past half later', () => {
    expect(seasonAt(new Date(Date.UTC(2027, 1, 1))).progress).toBeLessThan(0.05);
    expect(seasonAt(new Date(Date.UTC(2027, 1, 20))).progress).toBeGreaterThan(0.5);
  });
});
