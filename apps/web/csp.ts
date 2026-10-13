// Single source for the Content-Security-Policy (NFR-4). Used by `vite preview`
// and emitted as `_headers` for Cloudflare Pages / Netlify.
export const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the barcode decoder (WebAssembly) run where the browser has no built-in reader. It does not allow eval().
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://world.openfoodfacts.org",
  "manifest-src 'self'",
  "worker-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), interest-cohort=()',
};

export function headersFile(): string {
  const lines = Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`);
  return ['/*', ...lines, '', '/sw.js', '  Cache-Control: no-cache', ''].join('\n');
}
