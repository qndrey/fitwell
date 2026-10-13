import { createMcpHandler } from '@modelcontextprotocol/server';
import { offClient } from './off';
import { createServer } from './server';

const mcp = createMcpHandler(() => createServer({ off: offClient() }), {
  onerror: (e) => console.error('mcp', e),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/mcp') {
      // DEV_UNAUTHENTICATED is set only in .dev.vars (see .dev.vars.example). Until sign-in (OAuth) exists, refuse to serve anywhere but a local dev session, so a deploy can't expose an open endpoint.
      if (env.DEV_UNAUTHENTICATED !== 'true') return new Response('Sign-in is not set up on this server yet.', { status: 503 });
      return mcp.fetch(request);
    }
    if (url.pathname === '/') return new Response('Fitwell MCP server. Connect Claude to /mcp.\n', { headers: { 'content-type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
