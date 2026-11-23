# MCP Registry listing

`server.json` lists Fitwell in the official [MCP Registry](https://registry.modelcontextprotocol.io) as
`fyi.fitwell/fitwell`, a remote server at `https://mcp.fitwell.fyi/mcp`. Directories such as Glama, PulseMCP and
mcp.directory read from the registry. Being listed there does not add Fitwell to any app's own connector list
(Claude, ChatGPT, Le Chat): those are separate reviews.

The `fyi.fitwell/*` namespace is proved by a DNS TXT record on `fitwell.fyi`. The registry does not check the remote
URL itself; it only checks that we control the domain in the name.

## One-time setup

1. Make a signing key on your own machine (OpenSSL 3; on macOS use `brew install openssl@3`, not the system one):

   ```bash
   openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem
   echo "v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
   ```

2. In Cloudflare, DNS for `fitwell.fyi`: add a **TXT** record, name `@` (the apex, not a subdomain like
   `_mcp-auth`), content the `v=MCPv1; ...` line printed above. Leave any other TXT records (SPF, Resend) as they are.
   Check it with `dig +short TXT fitwell.fyi`.

3. Turn the private key into hex and save it as the repository secret `MCP_PRIVATE_KEY`
   (GitHub: Settings → Secrets and variables → Actions):

   ```bash
   openssl pkey -in mcp-registry-key.pem -noout -text | sed -n '/priv:/,/pub:/p' | sed '1d;$d' | tr -d ' :\n'
   ```

   Keep `mcp-registry-key.pem` somewhere safe (a password manager) and never commit it. To retire the key, delete
   the TXT record.

## Publishing

1. Raise `"version"` in `server.json` (each version can be published only once, and its metadata cannot be changed
   afterwards). Keep it in step with the version in `src/server.ts`.
2. Merge to `main`, then run **Publish to MCP Registry** from the Actions tab.
3. Check: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=fyi.fitwell"`.

From a laptop instead of CI: install `mcp-publisher`
([releases](https://github.com/modelcontextprotocol/registry/releases) or `brew install mcp-publisher`), then

```bash
MCP_PRIVATE_KEY="<hex from step 3>" mcp-publisher login dns --domain fitwell.fyi
mcp-publisher publish apps/mcp/registry/server.json
```
