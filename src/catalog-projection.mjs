/** Host-only latest catalog proof, recovered by the official Session projection registry. */
import { z } from 'zod';
import { readCatalogProof } from './catalog-lifecycle.mjs';

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema = z.object({
  version: z.literal(1),
  rawFingerprint: fingerprintSchema,
  rulesFingerprint: fingerprintSchema,
  publishedFingerprint: fingerprintSchema,
});
const stateSchema = z.object({ latest: z.object({
  seq: z.number().int().nonnegative(),
  proof: proofSchema.nullable(),
}).nullable() });

/**
 * Define the single latest catalog observation; registration and its handle stay with the plugin.
 * @returns A host-only definition containing no text, entries, process resources or history index.
 */
export function createCatalogProjection() {
  return {
    key: 'dshSmartSelectorCatalog',
    stateVersion: 1,
    stateSchema,
    init: () => ({ latest: null }),
    apply(state, event) {
      if (event.type !== 'user/message' || event.data.source?.kind !== 'skill-catalog') return state;
      // A newer legacy or malformed catalog invalidates an older successful receipt too.
      return { latest: { seq: event.seq, proof: readCatalogProof(event.data) ?? null } };
    },
  };
}

/**
 * Read a proof only while that exact latest catalog remains model-visible.
 * @param state Current state from the plugin's private, ready projection handle.
 * @param visibleSeqs The Session's existing surface nodes; the reader performs no historical reads.
 * @returns The latest validated proof, or undefined after removal, replacement or a missing receipt.
 */
export function visibleCatalogProof(state, visibleSeqs) {
  const latest = state.latest;
  return latest !== null && visibleSeqs.includes(latest.seq) ? latest.proof ?? undefined : undefined;
}
