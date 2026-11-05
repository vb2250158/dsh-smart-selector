/** Persisted catalog receipts compare official observations with the entries actually published. */
import { createHash } from 'node:crypto';

const receiptKey = 'dsh-smart-selector:catalog';
const receiptVersion = 1;
const fingerprintPattern = /^[a-f0-9]{64}$/;

/** Preserve array order while making object-key insertion order irrelevant to fingerprints. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Read public catalog entries without interpreting model prose or plugin metadata. */
function catalogValue(message) {
  const source = message?.source;
  if (source?.kind !== 'skill-catalog' || source.form !== 'catalog' || !Array.isArray(source.entries)
    || source.incomplete !== undefined && source.incomplete !== true
    || source.entries.some(entry => !entry || typeof entry.name !== 'string' || typeof entry.description !== 'string')) return undefined;
  return { entries: source.entries.map(({ name, description }) => ({ name, description })), incomplete: source.incomplete === true };
}

/**
 * Identify an official pending catalog and the validated catalog-rule chain.
 * @param rawMessage Official pending catalog; absence or invalid durable data returns undefined.
 * @param settings Resolved selector settings; only judgement routing and the input budget are hashed.
 * @param catalogRules Ordered validated catalog rules; their complete execution parameters are hashed.
 * @returns Hash-only identity, or undefined when no valid official catalog was supplied.
 */
export function catalogIdentity(rawMessage, settings, catalogRules) {
  const raw = catalogValue(rawMessage);
  if (!raw) return undefined;
  return {
    version: receiptVersion,
    rawFingerprint: fingerprint(raw),
    rulesFingerprint: fingerprint({ provider: settings.provider, model: settings.model, nativeJev: settings.nativeJev,
      maxContextCharacters: settings.maxContextCharacters,
      decisionApi: { enabled: settings.decisionApi?.enabled, model: settings.decisionApi?.model }, rules: catalogRules }),
  };
}

/**
 * Validate a durable receipt against the entries its message actually published.
 * @param message Published catalog; absent, legacy or malformed messages return undefined.
 * @returns Independent hash-only proof, or undefined when the publication cannot be verified.
 */
export function readCatalogProof(message) {
  const published = catalogValue(message);
  const receipt = message?.source?.[receiptKey];
  if (!published || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.version !== receiptVersion
    || !['rawFingerprint', 'rulesFingerprint', 'publishedFingerprint'].every(key =>
      typeof receipt[key] === 'string' && fingerprintPattern.test(receipt[key]))
    || receipt.publishedFingerprint !== fingerprint(published)) return undefined;
  return { version: receiptVersion, rawFingerprint: receipt.rawFingerprint, rulesFingerprint: receipt.rulesFingerprint,
    publishedFingerprint: receipt.publishedFingerprint };
}

/**
 * Compare a pending official observation with a validated, currently visible publication proof.
 * @param identity Official pending catalog identity; undefined returns false.
 * @param proof Validated proof from readCatalogProof or its registered Session projection; absence returns false.
 * @returns Whether the raw catalog and ordered rule chain are unchanged.
 */
export function canReuseCatalogProof(identity, proof) {
  return !!identity && !!proof && identity.version === receiptVersion && proof.version === receiptVersion
    && identity.rawFingerprint === proof.rawFingerprint && identity.rulesFingerprint === proof.rulesFingerprint;
}

/**
 * Check only the caller's latest visible catalog; this helper owns no history or process cache.
 * @param identity Identity of the official pending catalog; undefined never reuses a publication.
 * @param visibleMessage Latest visible catalog from the same session and source; absence returns false.
 * @returns Whether its persisted receipt and currently published entries still match.
 */
export function canReuseCatalog(identity, visibleMessage) {
  return canReuseCatalogProof(identity, readCatalogProof(visibleMessage));
}

/**
 * Stamp a successfully completed prune chain without changing its actual published entries or prose.
 * @param publishedMessage Final catalog after every enabled prune rule succeeded.
 * @param identity Identity captured from the official raw catalog before the chain ran.
 * @returns New message and source carrying only a version and three SHA256 fingerprints.
 */
export function stampCatalog(publishedMessage, identity) {
  const published = catalogValue(publishedMessage);
  if (!published || !identity || identity.version !== receiptVersion) throw new TypeError('Catalog receipt requires an official catalog identity and published entries');
  return { ...publishedMessage, source: { ...publishedMessage.source, [receiptKey]: {
    version: receiptVersion, rawFingerprint: identity.rawFingerprint, rulesFingerprint: identity.rulesFingerprint,
    publishedFingerprint: fingerprint(published),
  } } };
}
