// Secrets are not visible to `wrangler types`; declare them here.
interface Env {
  /** Test-deploy access path (see src/index.ts). Set with `wrangler secret put SPIKE_TOKEN`. */
  SPIKE_TOKEN?: string;
}
