// Local MCP Apps host on http://127.0.0.1:8788: renders the workout player like Claude does and proxies
// /mcp to `npm run dev` (wrangler, :8787). Run both: npm run dev -w @fitwell/mcp, then npm run dev:host -w @fitwell/mcp
import { build } from 'esbuild';
import { createServer } from 'node:http';

const UPSTREAM = process.env.MCP_UPSTREAM ?? 'http://127.0.0.1:8787';
const js = (await build({ entryPoints: ['dev-host/host.ts'], bundle: true, format: 'esm', target: 'es2022', write: false })).outputFiles[0]!.text;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fitwell dev host</title><style>
body{margin:0;font:14px system-ui;background:#e9e6e1;color:#222;display:grid;gap:12px;padding:12px;justify-items:center}
[data-theme=dark] body{background:#111;color:#ddd}
iframe{width:100%;max-width:430px;height:600px;border:1px solid #bbb;border-radius:16px;background:transparent}
ol{max-width:430px;width:100%;font:12px ui-monospace,monospace;padding-left:16px;word-break:break-word}
</style></head><body><p>Dev host · <a href="?theme=light">light</a> · <a href="?theme=dark">dark</a> · <a href="?view=dashboard">dashboard</a> · <a href="?">workout</a></p>
<iframe id="view" title="Workout player" sandbox="allow-scripts"></iframe><ol id="log"></ol>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

createServer(async (req, res) => {
  // /raw/<view>: the view's HTML as a normal page (no host), to see console errors and plain rendering.
  const raw = /^\/raw\/([a-z-]+)$/.exec(req.url ?? '');
  if (raw) {
    try {
      const mod = (await import(`../src/ui/generated/${raw[1]}.ts`)) as { default: string };
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(mod.default);
    } catch {
      res.writeHead(404).end('No such view');
    }
    return;
  }
  if (req.url?.startsWith('/mcp')) {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise<Buffer>((r) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => r(Buffer.concat(chunks)));
    });
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k, v]) => typeof v === 'string' && k !== 'host')) as Record<string, string>;
    const up = await fetch(UPSTREAM + req.url, { method: req.method, headers, body });
    // fetch has already decompressed the body: drop the headers that describe the compressed one.
    const headersOut = Object.fromEntries([...up.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
    res.writeHead(up.status, headersOut);
    res.end(Buffer.from(await up.arrayBuffer()));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
}).listen(8788, '127.0.0.1', () => console.log('Dev host on http://127.0.0.1:8788 (proxying /mcp to ' + UPSTREAM + ')'));
