import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { handleAuthorize, SCOPE } from './auth/login';
import { cloudflareMailer } from './auth/mailer';
import { page, privacyBody } from './auth/pages';
import { handleImport } from './import/routes';
import { cachedOff } from './data/offCache';
import { deleteUser, findUser, inviteUser, recordLogin, type User } from './data/users';
import { offClient } from './off';
import { createServer } from './server';

/** What completeAuthorization() stored for the token: the signed-in person. */
interface Props {
  userId: string;
  email: string;
}
type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

const DEV_EMAIL = 'dev@localhost';
const DAY = 86_400;

/** Serves MCP for one signed-in person (one fresh server per request). */
async function serveMcp(request: Request, env: Env, user: Pick<User, 'id' | 'email'>, oauth?: OAuthHelpers): Promise<Response> {
  const handler = createMcpHandler(
    () =>
      createServer({
        off: cachedOff(env.DB, offClient()),
        db: env.DB,
        publicUrl: env.PUBLIC_URL,
        user,
        deleteAccount: async () => {
          // Sign out everywhere first, then erase the data.
          if (oauth) for (const g of (await oauth.listUserGrants(user.id)).items) await oauth.revokeGrant(g.id, user.id);
          await deleteUser(env.DB, user);
        },
      }),
    { onerror: (e) => console.error('mcp', e.message) },
  );
  return handler.fetch(request);
}

const site = {
  async fetch(request: Request, env: EnvWithOAuth): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize' || url.pathname === '/authorize/link') {
      return handleAuthorize(request, { db: env.DB, oauth: env.OAUTH_PROVIDER, mailer: cloudflareMailer(env), publicUrl: env.PUBLIC_URL });
    }
    if (url.pathname === '/import' || url.pathname === '/import/chunk' || url.pathname === '/import/finish') return handleImport(request, { db: env.DB });
    if (url.pathname === '/privacy') return page('Fitwell privacy notice', privacyBody(env.CONTACT_EMAIL));
    if (url.pathname === '/') return new Response(`Fitwell MCP server. Add ${env.PUBLIC_URL}/mcp to Claude as a custom connector.\n`, { headers: { 'content-type': 'text/plain' } });
    return new Response('Not found', { status: 404 });
  },
};

let provider: OAuthProvider<Env> | null = null;
function oauthProvider(env: Env): OAuthProvider<Env> {
  provider ??= new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: {
      async fetch(request, env, ctx) {
        const props = (ctx as ExecutionContext<Props>).props;
        // A token outlives a deleted account until it expires; refuse it as soon as the person is gone.
        const user = await findUser(env.DB, props.userId);
        if (!user) return new Response('This Fitwell account no longer exists.', { status: 401 });
        return serveMcp(request, env, user, (env as EnvWithOAuth).OAUTH_PROVIDER);
      },
    },
    defaultHandler: site as unknown as ExportedHandler<Env>,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [SCOPE],
    requiredScopes: [SCOPE],
    resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL] },
    // Stay signed in while Claude keeps using it; a grant idle for 60 days expires.
    refreshTokenIdleTTL: 60 * DAY,
  });
  return provider;
}

const isLocal = (url: URL) => url.hostname === '127.0.0.1' || url.hostname === 'localhost';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Local development only: /mcp without sign-in, as a fixed dev person. Never on a public host, and never
    // for a request that carries a token (so the real sign-in can be tried locally too).
    if (url.pathname === '/mcp' && env.DEV_UNAUTHENTICATED === 'true' && isLocal(url) && !request.headers.has('Authorization')) {
      const user = await inviteUser(env.DB, DEV_EMAIL, 'Dev');
      if (!user.last_login_at) await recordLogin(env.DB, user.id);
      return serveMcp(request, env, user);
    }
    return oauthProvider(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
