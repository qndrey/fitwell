// Renders an EAN-13 / UPC-A barcode as a grayscale bitmap so scanning can be tested without a real camera.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** 95 modules (1 = bar) for a 13-digit EAN. */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('need 13 digits');
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  let out = '101';
  for (let i = 0; i < 6; i++) out += (parity[i] === 'L' ? L : G)[d[i + 1]!]!;
  out += '01010';
  for (let i = 0; i < 6; i++) out += R[d[i + 7]!]!;
  return out + '101';
}

/** RGBA pixels: dark bars on a white page with quiet zones. */
export function ean13Pixels(code: string, scale = 3, height = 120): { data: Uint8ClampedArray; width: number; height: number } {
  const modules = ean13Modules(code);
  const quiet = 12;
  const width = (modules.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let m = 0; m < modules.length; m++) {
    if (modules[m] !== '1') continue;
    for (let y = 0; y < height; y++) for (let x = 0; x < scale; x++) {
      const i = (y * width + (quiet + m) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width, height };
}
