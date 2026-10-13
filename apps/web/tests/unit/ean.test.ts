import { describe, expect, it } from 'vitest';
import { gtinValid, looksLikeBarcode, normalizeBarcode } from '../../src/scan/ean';

describe('barcodes', () => {
  it('validates GTIN check digits (EAN-13, UPC-A, EAN-8)', () => {
    for (const ok of ['4006381333931', '036000291452', '96385074', '5449000000996', '3017620422003']) expect(gtinValid(ok), ok).toBe(true);
    for (const bad of ['4006381333930', '036000291453', '96385075', '123', '', 'abcdefghijklm', '40063813339311', '4006381333931 ']) expect(gtinValid(bad), bad).toBe(false);
  });
  it('normalises to the 13-digit form Open Food Facts uses', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    expect(normalizeBarcode('4006-3813 33931')).toBe('4006381333931');
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('04006381333931')).toBe('4006381333931'); // GTIN-14 with leading zero
    expect(normalizeBarcode('4006381333930')).toBeNull();
  });
  it('tells scanned codes from typed food names', () => {
    expect(looksLikeBarcode('4006381333931')).toBe(true);
    expect(looksLikeBarcode('4006 3813 33931')).toBe(true);
    expect(looksLikeBarcode('oat drink')).toBe(false);
    expect(looksLikeBarcode('2 eggs')).toBe(false);
    expect(looksLikeBarcode('1234567')).toBe(false);
  });
});
