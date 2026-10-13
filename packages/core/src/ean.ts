/** GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14): weights 3,1,3,1… from the right, excluding the check digit. */
export function gtinValid(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * The form Open Food Facts stores: UPC-A (12) and GTIN-14 with a leading zero become 13-digit EAN-13.
 * Returns null when it is not a valid barcode.
 */
export function normalizeBarcode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '');
  if (!gtinValid(code)) return null;
  if (code.length === 12) return `0${code}`;
  if (code.length === 14 && code.startsWith('0')) return code.slice(1);
  return code;
}

/** Digits that could be a barcode (used to tell "scanned code" entries from typed food names). */
export const looksLikeBarcode = (text: string): boolean => /^\d{8,14}$/.test(text.replace(/[\s-]/g, ''));
