import { describe, expect, it } from 'vitest';
import { readBarcodes } from 'zxing-wasm/reader';
import { ean13Modules, ean13Pixels } from '../helpers/ean';
import { gtinValid } from '../../src/scan/ean';

describe('barcode decoding (the same ZXing engine the app ships)', () => {
  it('the test encoder produces valid, 95-module EAN-13 patterns', () => {
    expect(ean13Modules('4006381333931')).toHaveLength(95);
    expect(ean13Modules('4006381333931').startsWith('101')).toBe(true);
  });

  it('reads EAN-13 and UPC-A (as EAN-13 with a leading 0) from an image', async () => {
    for (const code of ['4006381333931', '3017620422003', '0036000291452']) {
      expect(gtinValid(code)).toBe(true);
      const px = ean13Pixels(code);
      const res = await readBarcodes({ data: px.data, width: px.width, height: px.height, colorSpace: 'srgb' } as ImageData, { formats: ['EAN-13', 'UPC-A', 'EAN-8', 'UPC-E'], tryHarder: true, maxNumberOfSymbols: 1 });
      expect(res.map((r) => r.text), code).toEqual([code]);
    }
  });

  it('finds nothing in a blank image', async () => {
    const data = new Uint8ClampedArray(200 * 100 * 4).fill(255);
    expect(await readBarcodes({ data, width: 200, height: 100, colorSpace: 'srgb' } as ImageData, { formats: ['EAN-13'] })).toEqual([]);
  });
});
