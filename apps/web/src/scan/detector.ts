import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Retail barcode formats only (food packaging): the narrower the list, the faster and less error-prone. */
export const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface Detector {
  kind: 'native' | 'wasm';
  /** Reads barcodes from a video frame / canvas / image; returns the raw text of each. */
  detect(source: CanvasImageSource | ImageBitmap | ImageData): Promise<string[]>;
}

interface DetectorLike {
  detect(source: unknown): Promise<{ rawValue: string }[]>;
}

async function nativeDetector(): Promise<DetectorLike | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): DetectorLike; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const supported = await BD.getSupportedFormats();
    return FORMATS.every((f) => supported.includes(f)) ? new BD({ formats: [...FORMATS] }) : null;
  } catch {
    return null;
  }
}

/**
 * Uses the browser's built-in BarcodeDetector when it can read retail codes (Chrome/Edge/Samsung on Android).
 * Everywhere else (Safari, Firefox) it loads a small WebAssembly decoder, served from this app,
 * never from a CDN, only when the scanner is opened.
 */
export async function createDetector(): Promise<Detector> {
  const native = await nativeDetector();
  if (native) return { kind: 'native', detect: async (src) => (await native.detect(src)).map((r) => r.rawValue) };

  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  // The library's default is to fetch its .wasm from jsDelivr: point it at our own copy instead.
  await prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }, fireImmediately: true });
  const d = new BarcodeDetector({ formats: [...FORMATS] });
  return { kind: 'wasm', detect: async (src) => (await d.detect(src as ImageBitmapSource)).map((r) => r.rawValue) };
}
