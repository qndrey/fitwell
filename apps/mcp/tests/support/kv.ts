// In-memory KV with the parts of the API the OAuth library uses: get (text/json), put (with expiry), delete, list.
type Entry = { value: string; expiration?: number; metadata?: unknown };

export function createTestKV(now: () => number = Date.now): KVNamespace {
  const store = new Map<string, Entry>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e?.expiration && e.expiration * 1000 <= now()) {
      store.delete(k);
      return undefined;
    }
    return e;
  };
  const kv = {
    async get(key: string, opts?: string | { type?: string }) {
      const e = live(key);
      if (!e) return null;
      const type = typeof opts === 'string' ? opts : opts?.type;
      return type === 'json' ? JSON.parse(e.value) : e.value;
    },
    async put(key: string, value: string, opts: { expirationTtl?: number; expiration?: number; metadata?: unknown } = {}) {
      const expiration = opts.expiration ?? (opts.expirationTtl ? Math.floor(now() / 1000) + opts.expirationTtl : undefined);
      store.set(key, { value, expiration, metadata: opts.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const names = [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '') && live(k)).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const limit = opts.limit ?? 1000;
      const page = names.slice(start, start + limit);
      const done = start + limit >= names.length;
      return {
        keys: page.map((name) => ({ name, expiration: store.get(name)!.expiration, metadata: store.get(name)!.metadata })),
        list_complete: done,
        ...(done ? {} : { cursor: String(start + limit) }),
        cacheStatus: null,
      };
    },
  };
  return kv as unknown as KVNamespace;
}
