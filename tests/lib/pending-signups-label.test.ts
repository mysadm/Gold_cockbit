import { describe, it, expect } from 'vitest';
import { pendingSignupsLabel } from '../../src/ui/Sidebar';

describe('pendingSignupsLabel (Settings badge accessible name)', () => {
  it('speaks of items needing attention in English', () => {
    expect(pendingSignupsLabel(1, false)).toBe('1 item needs attention');
    expect(pendingSignupsLabel(2, false)).toBe('2 items need attention');
    expect(pendingSignupsLabel(12, false)).toBe('12 items need attention');
  });

  it('uses correct Arabic singular, dual and plural forms', () => {
    expect(pendingSignupsLabel(1, true)).toBe('عنصر واحد يحتاج إلى انتباه');
    expect(pendingSignupsLabel(2, true)).toBe('عنصران يحتاجان إلى انتباه');
    expect(pendingSignupsLabel(3, true)).toBe('٣ عناصر تحتاج إلى انتباه');
    expect(pendingSignupsLabel(10, true)).toBe('١٠ عناصر تحتاج إلى انتباه');
    expect(pendingSignupsLabel(11, true)).toBe('١١ عنصرًا يحتاج إلى انتباه');
  });
});
