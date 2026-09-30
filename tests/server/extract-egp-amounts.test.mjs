import { describe, it, expect } from 'vitest';
import { extractEgpAmounts } from '../../shared/analystContract.mjs';

// Shared by v3's reads.dca check and v4's dca_read check — a missed amount here is a real safety
// gap (a user could be told to invest above their current installment limit). Semantic: a wrong
// amount is never auto-repaired by server/providers/formatRepair.mjs, only ever retried.
describe('extractEgpAmounts', () => {
  it('reads plain Western digits with "EGP"', () => {
    expect(extractEgpAmounts('Deploy 40000 EGP now.')).toEqual([40000]);
  });

  it('reads EGP as a prefix', () => {
    expect(extractEgpAmounts('Deploy EGP 40001 now.')).toEqual([40001]);
  });

  it('reads Arabic-Indic digits with an Arabic thousands separator (١٠٬٠٠٠)', () => {
    expect(extractEgpAmounts('نفذ ١٠٬٠٠٠ جنيه الآن')).toEqual([10000]);
  });

  it('reads "جنيه" as a suffix and as a prefix', () => {
    expect(extractEgpAmounts('استثمر 40000 جنيه')).toEqual([40000]);
    expect(extractEgpAmounts('استثمر جنيه 40000')).toEqual([40000]);
  });

  it('reads "ج.م" (the common written abbreviation for Egyptian pounds)', () => {
    expect(extractEgpAmounts('استثمر 40000 ج.م الآن')).toEqual([40000]);
  });

  it('reads "LE" (Livre Égyptienne / Egyptian pound abbreviation)', () => {
    expect(extractEgpAmounts('Deploy LE 40000 now.')).toEqual([40000]);
    expect(extractEgpAmounts('Deploy 40000 LE now.')).toEqual([40000]);
  });

  it('does not mistake "LE" for part of an unrelated word', () => {
    expect(extractEgpAmounts('The tranche is due in the near future, like usual.')).toEqual([]);
  });

  it('strips Western thousands separators', () => {
    expect(extractEgpAmounts('Deploy 100,000 EGP now.')).toEqual([100000]);
  });

  it('strips Arabic thousands separators combined with Western digits', () => {
    // A model can mix an Arabic separator with Western digits — still must normalize correctly.
    expect(extractEgpAmounts('Deploy 100٬000 EGP now.')).toEqual([100000]);
  });

  it('reads a "10k" shorthand multiplier', () => {
    expect(extractEgpAmounts('Deploy 10k EGP now.')).toEqual([10000]);
    expect(extractEgpAmounts('Deploy 40K EGP now.')).toEqual([40000]);
  });

  it('reads an Arabic "ألف" (thousand) multiplier', () => {
    expect(extractEgpAmounts('استثمر 10 ألف جنيه الآن')).toEqual([10000]);
  });

  it('reads multiple amounts in the same text', () => {
    expect(extractEgpAmounts('Either 20000 EGP now or 40000 EGP next month.')).toEqual([20000, 40000]);
  });

  it('returns an empty array when no amount is mentioned', () => {
    expect(extractEgpAmounts('Within the current tranche limit, no specific figure given.')).toEqual([]);
  });

  it('returns an empty array for non-string input', () => {
    expect(extractEgpAmounts(undefined)).toEqual([]);
    expect(extractEgpAmounts(null)).toEqual([]);
    expect(extractEgpAmounts(42)).toEqual([]);
  });
});
