import { createMcpHandler } from '@modelcontextprotocol/server';
import { offClient } from './off';
import { createServer } from './server';

const mcp = createMcpHandler(() => createServer({ off: offClient() }), {
  onerror: (e) => console.error('mcp', e),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Until sign-in (OAuth, phase 1) exists, /mcp is served only in a local dev session (DEV_UNAUTHENTICATED in
    // .dev.vars), and a deployed test server only at /mcp/<SPIKE_TOKEN>, a long random secret set with
    // `wrangler secret put SPIKE_TOKEN`. Without either, nothing is served, so a deploy can't expose an open endpoint.
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const dev = env.DEV_UNAUTHENTICATED === 'true' && url.pathname === '/mcp';
      const spike = typeof env.SPIKE_TOKEN === 'string' && env.SPIKE_TOKEN.length >= 32 && url.pathname === `/mcp/${env.SPIKE_TOKEN}`;
      if (!dev && !spike) return new Response('Sign-in is not set up on this server yet.', { status: 503 });
      return mcp.fetch(request);
    }
    if (url.pathname === '/') return new Response('Fitwell MCP server. Connect Claude to /mcp.\n', { headers: { 'content-type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
