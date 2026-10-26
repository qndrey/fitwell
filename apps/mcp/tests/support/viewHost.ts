// A bare MCP Apps host for the read-only views (dashboard, review, food): it answers the handshake and sends one tool result.
// The built view runs in a real Chromium inside an iframe, as Claude embeds it. Nothing of the view is mocked.
import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright';

interface HostWindow {
  window: { __send(message: unknown): void };
  document: { getElementById(id: string): { srcdoc: string } | null };
}

export interface OpenedView {
  page: Page;
  frame: FrameLocator;
  /** Tool calls the view made, in order. */
  calls: { name: string; args: Record<string, unknown> }[];
}

let browser: Browser | null = null;
const contexts: BrowserContext[] = [];

export async function launch() {
  browser = await chromium.launch();
}

export async function closeAll() {
  for (const c of contexts.splice(0)) await c.close();
  await browser?.close();
  browser = null;
}

export async function openView(html: string, result: unknown, o: { theme?: 'light' | 'dark'; width?: number; tools?: (name: string, args: Record<string, unknown>) => unknown; hostCapabilities?: Record<string, unknown> } = {}): Promise<OpenedView> {
  const context = await browser!.newContext({ viewport: { width: o.width ?? 398, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  const calls: OpenedView['calls'] = [];
  await page.exposeFunction('__toHost', async (msg: { id?: number; method: string; params?: Record<string, unknown> }) => {
    if (msg.method === 'ui/initialize') return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' }, hostCapabilities: o.hostCapabilities ?? {}, hostContext: { theme: o.theme ?? 'light', displayMode: 'inline', platform: 'web' } } };
    if (msg.method === 'ui/notifications/initialized') {
      setTimeout(() => void page.evaluate((r) => (globalThis as unknown as HostWindow).window.__send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }), result), 0);
      return null;
    }
    if (msg.method === 'tools/call') {
      const name = String(msg.params?.name);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      calls.push({ name, args });
      return { jsonrpc: '2.0', id: msg.id, result: o.tools?.(name, args) ?? { content: [{ type: 'text', text: 'ok' }] } };
    }
    // A file the view asks the host to save is recorded like a tool call, under the method's own name.
    if (msg.method === 'ui/download-file') calls.push({ name: msg.method, args: (msg.params ?? {}) as Record<string, unknown> });
    return msg.id !== undefined ? { jsonrpc: '2.0', id: msg.id, result: {} } : null;
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0"><iframe id="v" sandbox="allow-scripts" style="width:100%;height:1300px;border:0"></iframe>
    <script>
      const f = document.getElementById('v');
      window.__send = (m) => f.contentWindow.postMessage(m, '*');
      window.addEventListener('message', async (e) => {
        if (e.source !== f.contentWindow) return;
        const reply = await window.__toHost(e.data);
        if (reply) window.__send(reply);
      });
    </script></body></html>`,
  );
  await page.evaluate((h) => {
    const el = (globalThis as unknown as HostWindow).document.getElementById('v');
    if (el) el.srcdoc = h;
  }, html);
  return { page, frame: page.frameLocator('#v'), calls };
}
