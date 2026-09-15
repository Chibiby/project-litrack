import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// Backs Next's Data Cache so `cachedQuery` (src/lib/cache/unstable.ts) caches
// across requests again and the `revalidate*` helpers actually invalidate.
//
// - Entries live in KV (`NEXT_INC_CACHE_KV`). KV is eventually consistent, but
//   invalidation does not depend on it: every read checks its tags against
//   D1, which is strongly consistent, so a revalidated entry is a miss at once.
// - Tag revalidations live in D1 (`NEXT_TAG_CACHE_D1`, table `revalidations`,
//   created by `opennextjs-cloudflare deploy` if missing).
//
// KV rather than R2 because R2 is not enabled on the account.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
});
