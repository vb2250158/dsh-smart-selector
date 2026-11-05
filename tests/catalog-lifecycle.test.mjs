import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogIdentity, canReuseCatalog, stampCatalog, readCatalogProof, canReuseCatalogProof } from '../src/catalog-lifecycle.mjs';
import { reconcileContext, readContext } from '../src/context-policy.mjs';

const receiptKey = 'dsh-smart-selector:catalog';
const settings = { provider: 'fixture', model: 'ordinary-judge', nativeJev: false, maxContextCharacters: 12000,
  decisionApi: { enabled: false, model: 'typesafe/jev-1.13', timeoutMs: 30000 } };
const rule = { id: 'skills', enabled: true, phase: 'skill-catalog', input: 'current-context-text', questionSource: 'configured',
  question: 'Select relevant skills.', questionType: 'noul', threshold: 0, selectionMode: 'top', selectionValue: '2', selectionAction: 'prune' };
const entries = Array.from({ length: 8 }, (_, index) => ({ name: `skill-${index}`, description: `Synthetic description ${index}` }));
const catalog = (items = entries, source = {}) => ({ role: 'user', source: { kind: 'skill-catalog', form: 'catalog', entries: items, ...source },
  content: [{ type: 'text', text: '<available_skills>\n' + items.map(entry => `- ${entry.name}: ${entry.description}`).join('\n') + '\n</available_skills>' }] });
const identity = (raw = catalog(), config = settings, rules = [rule]) => catalogIdentity(raw, config, rules);
const published = () => stampCatalog(catalog(entries.slice(0, 2)), identity());

test('a receipt reuses the visible selected catalog when the same official raw catalog is proposed', () => {
  const selected = published();
  assert.equal(canReuseCatalog(identity(catalog(entries, { update: true })), selected), true);
  assert.equal(selected.source.entries.length, 2);
  assert.equal(selected.content[0].text.includes('skill-7'), false);
  assert.deepEqual(Object.keys(selected.source[receiptKey]).sort(), ['publishedFingerprint', 'rawFingerprint', 'rulesFingerprint', 'version']);
  assert(Object.values(selected.source[receiptKey]).filter(value => typeof value === 'string').every(value => /^[a-f0-9]{64}$/.test(value)));
});

test('stamping is immutable and preserves the final publication rather than hiding raw entries', () => {
  const message = catalog(entries.slice(0, 2));
  const stamped = stampCatalog(message, identity());
  assert.notEqual(stamped, message);
  assert.notEqual(stamped.source, message.source);
  assert.equal(stamped.source.entries, message.source.entries);
  assert.equal(stamped.content, message.content);
  assert.equal(message.source[receiptKey], undefined);
});

test('raw descriptions, membership, order and discovery completeness invalidate reuse', () => {
  for (const raw of [catalog(entries.slice(1)), catalog([...entries].reverse()),
    catalog(entries.map((entry, index) => index ? entry : { ...entry, description: 'Changed' })), catalog(entries, { incomplete: true })]) {
    assert.equal(canReuseCatalog(identity(raw), published()), false);
  }
  const incomplete = catalog(entries, { incomplete: true });
  const stamped = stampCatalog(catalog(entries.slice(0, 2), { incomplete: true }), identity(incomplete));
  assert.equal(canReuseCatalog(identity(incomplete), stamped), true);
  assert.equal(canReuseCatalog(identity(), stamped), false);
});

test('published entries, order and incomplete flag must still match the receipt', () => {
  const selected = published();
  for (const source of [{ entries }, { entries: [...selected.source.entries].reverse() }, { incomplete: true },
    { entries: [{ ...entries[0], description: 'Edited' }, entries[1]] }]) {
    assert.equal(canReuseCatalog(identity(), { ...selected, source: { ...selected.source, ...source } }), false);
  }
});

test('routing, budget and complete ordered rule parameters invalidate reuse', () => {
  for (const config of [{ ...settings, provider: 'other' }, { ...settings, model: 'other' }, { ...settings, nativeJev: true },
    { ...settings, maxContextCharacters: 500 }, { ...settings, decisionApi: { ...settings.decisionApi, enabled: true } },
    { ...settings, decisionApi: { ...settings.decisionApi, model: 'typesafe/jev-2' } }]) {
    assert.equal(canReuseCatalog(identity(catalog(), config), published()), false);
  }
  for (const changed of [{ ...rule, question: 'Changed question' }, { ...rule, questionSource: 'script', questionScript: 'return { title: input }' },
    { ...rule, input: 'latest-user-message' }, { ...rule, customInput: 'Changed input' }, { ...rule, threshold: 0.5 },
    { ...rule, selectionValue: '1' }, { ...rule, scoreLevels: ['low', 'high'] }, { ...rule, enabled: false }]) {
    assert.equal(canReuseCatalog(identity(catalog(), settings, [changed]), published()), false);
  }
  const second = { ...rule, id: 'second', selectionValue: '1' };
  const stamped = stampCatalog(catalog(entries.slice(0, 1)), identity(catalog(), settings, [rule, second]));
  assert.equal(canReuseCatalog(identity(catalog(), settings, [second, rule]), stamped), false);
});

test('object-key order is canonical while unrelated settings and credential bodies are excluded', () => {
  const reordered = Object.fromEntries(Object.entries(rule).reverse());
  const config = { ...settings, apiKey: 'SYNTHETIC_SECRET', contextPolicy: { previewItems: 1 },
    decisionApi: { ...settings.decisionApi, timeoutMs: 1000, apiKey: 'ANOTHER_SYNTHETIC_SECRET' } };
  assert.deepEqual(identity(catalog(), config, [reordered]), identity());
  assert.equal(JSON.stringify(identity(catalog(), config)).includes('SECRET'), false);
});

test('legacy, unsupported and malformed durable receipts fall through to normal selection', () => {
  assert.equal(canReuseCatalog(identity(), catalog(entries.slice(0, 2))), false);
  for (const receipt of [null, [], '', {}, { ...published().source[receiptKey], version: 2 },
    { ...published().source[receiptKey], publishedFingerprint: 'broken' }, { ...published().source[receiptKey], rawFingerprint: 12 },
    { ...published().source[receiptKey], rulesFingerprint: undefined }]) {
    assert.equal(canReuseCatalog(identity(), catalog(entries.slice(0, 2), { [receiptKey]: receipt })), false);
  }
  assert.equal(canReuseCatalog(identity(), { source: { kind: 'skill-catalog', form: 'catalog', entries: [null] } }), false);
  assert.equal(canReuseCatalog(identity(), catalog(entries.slice(0, 2), { incomplete: false, [receiptKey]: published().source[receiptKey] })), false);
});

test('no official pending catalog or no visible catalog cannot reuse anything', () => {
  assert.equal(catalogIdentity(undefined, settings, [rule]), undefined);
  assert.equal(catalogIdentity({ source: { kind: 'user' } }, settings, [rule]), undefined);
  assert.equal(canReuseCatalog(undefined, published()), false);
  assert.equal(canReuseCatalog(identity(), undefined), false);
  assert.equal(canReuseCatalog(identity(), catalog(entries.slice(0, 2))), false);
});

test('receipts survive durable JSON replay without any process-local cache', () => {
  const replayed = JSON.parse(JSON.stringify(published()));
  assert.equal(canReuseCatalog(identity(), replayed), true);
  assert.equal(canReuseCatalog(identity(), catalog(entries.slice(0, 2))), false, 'another session has no receipt merely because this process stamped one');
  assert.equal(canReuseCatalog(identity(), undefined), false, 'a compacted-away publication cannot be recovered from process state');
});

test('projection proof contains only independent validated hashes and invalid publications have no proof', () => {
  const selected = published();
  const proof = readCatalogProof(selected);
  assert.deepEqual(proof, selected.source[receiptKey]);
  assert.notEqual(proof, selected.source[receiptKey]);
  assert.equal(canReuseCatalogProof(identity(), proof), true);
  assert.equal(canReuseCatalogProof(undefined, proof), false);
  assert.equal(canReuseCatalogProof(identity(), undefined), false);
  assert.equal(canReuseCatalogProof(identity(), { ...proof, version: 2 }), false);
  assert.equal(readCatalogProof(catalog(entries.slice(0, 2))), undefined);
  assert.equal(readCatalogProof({ ...selected, source: { ...selected.source, entries } }), undefined);
});

test('context-policy rendering and full-text expansion preserve the catalog receipt', () => {
  const stamped = published();
  const message = { ...stamped, content: [{ type: 'text', text: stamped.content[0].text.repeat(30) }] };
  const events = [{ type: 'user/message', seq: 0, data: message }];
  const session = { id: 'synthetic-session', surface: { nodes: [0] }, eventAt: seq => events[seq],
    append(type, data, options) { const seq = events.length; events.push({ type, seq, data });
      if (options?.surfaceOp) this.surface.nodes = [seq]; } };
  reconcileContext({ session }, { turn: 1, step: 1 }, { estimateMessage: () => 100 },
    { catalogDescriptionCharacters: 20, maxSnapshotCharacters: 1000, previewItems: 1 },
    { createUserMessage: value => ({ role: 'user', ...value }), createDeveloperMessage: value => ({ role: 'developer', ...value }) });
  const rendered = events.at(-1).data;
  assert(rendered.source.contextPolicy);
  assert.equal(canReuseCatalog(identity(), rendered), true);
  assert.deepEqual(rendered.source.entries, message.source.entries);
  assert.equal(readContext(session, { seq: events.length - 1 }, 100000).content, message.content[0].text);
  assert.equal(canReuseCatalog(identity(), JSON.parse(JSON.stringify(rendered))), true);
});
