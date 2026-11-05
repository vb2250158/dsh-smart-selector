import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogProjection, visibleCatalogProof } from '../src/catalog-projection.mjs';
import { catalogIdentity, readCatalogProof, stampCatalog } from '../src/catalog-lifecycle.mjs';

const entries = Array.from({ length: 5 }, (_, index) => ({ name: `fixture-${index}`, description: `Synthetic skill ${index}` }));
const catalog = values => ({ role: 'user', source: { kind: 'skill-catalog', form: 'catalog', entries: values },
  content: [{ type: 'text', text: 'Synthetic catalog text' }] });
const settings = { provider: 'fixture', model: 'fixture-model', maxContextCharacters: 512 };
const rules = [{ id: 'fixture-rule', phase: 'skill-catalog', selectionAction: 'prune' }];
const publication = (values = entries) => stampCatalog(catalog(values.slice(0, 2)), catalogIdentity(catalog(values), settings, rules));
const event = (seq, data) => ({ type: 'user/message', seq, time: seq, data });
const fold = (definition, events, state = definition.init()) => events.reduce((value, row) => definition.apply(value, row), state);

test('latest catalog state is host-only, JSON-restorable and contains only a sequence and validated hashes', () => {
  const definition = createCatalogProjection();
  const message = publication();
  const state = definition.apply(definition.init(), event(4, message));
  assert.equal(definition.wire, undefined);
  assert.equal(definition.stateVersion, 1);
  assert.deepEqual(state, { latest: { seq: 4, proof: readCatalogProof(message) } });
  assert.deepEqual(definition.stateSchema.parse(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(Object.keys(state.latest), ['seq', 'proof']);
  assert.equal(JSON.stringify(state).includes('Synthetic'), false);
  assert.equal(visibleCatalogProof(state, [0, 4]), state.latest.proof);
});

test('unrelated events preserve state identity and cannot replay effects', () => {
  const definition = createCatalogProjection();
  const state = definition.apply(definition.init(), event(2, publication()));
  for (const row of [
    { type: 'turn/start', seq: 3, data: { turn: 1 } },
    event(4, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Another request' }] }),
    { type: 'assistant/message', seq: 5, data: {} },
    { type: 'compaction/prune', seq: 6, data: { shadowedSeqs: [2] } },
  ]) assert.equal(definition.apply(state, row), state);
});

test('every newer catalog replaces the old proof, including missing or malformed receipts', () => {
  const definition = createCatalogProjection();
  const previous = definition.apply(definition.init(), event(1, publication()));
  const malformed = publication();
  malformed.source['dsh-smart-selector:catalog'].publishedFingerprint = 'invalid';
  for (const message of [
    catalog(entries),
    malformed,
    { source: { kind: 'skill-catalog' }, content: [] },
    { source: { kind: 'skill-catalog', form: 'catalog', entries: [null] }, content: [] },
  ]) {
    const next = definition.apply(previous, event(3, message));
    assert.deepEqual(next, { latest: { seq: 3, proof: null } });
    assert.equal(visibleCatalogProof(next, [1, 3]), undefined);
  }
});

test('removing the latest catalog from the surface never falls back to an older visible receipt', () => {
  const definition = createCatalogProjection();
  const state = fold(definition, [event(2, publication()), event(5, publication())]);
  assert.equal(visibleCatalogProof(state, [2]), undefined);
  assert.equal(visibleCatalogProof(state, []), undefined);
  assert.equal(visibleCatalogProof(state, [2, 5]), state.latest.proof);
  assert.equal(visibleCatalogProof(definition.init(), [2, 5]), undefined);
});

test('a replacement catalog becomes the new visible proof without reading the replaced event', () => {
  const definition = createCatalogProjection();
  const original = publication();
  const replacement = publication(entries.slice(0, 3));
  const state = fold(definition, [event(2, original), event(7, replacement)]);
  assert.equal(visibleCatalogProof(state, [2]), undefined);
  assert.deepEqual(visibleCatalogProof(state, [7]), readCatalogProof(replacement));
  assert.notDeepEqual(state.latest.proof, readCatalogProof(original));
});

test('full replay and checkpoint suffix replay recover the same latest proof', () => {
  const definition = createCatalogProjection();
  const rows = [event(0, publication()), { type: 'turn/start', seq: 1, data: { turn: 1 } },
    event(2, catalog(entries)), event(3, publication(entries.slice(0, 4)))];
  const prefix = fold(definition, rows.slice(0, 2));
  const checkpoint = definition.stateSchema.parse(JSON.parse(JSON.stringify(prefix)));
  assert.deepEqual(fold(definition, rows.slice(2), checkpoint), fold(definition, rows));
});

test('fork seed replay uses only inherited events and remains independent of later parent catalogs', () => {
  const definition = createCatalogProjection();
  const inherited = [event(0, publication()), { type: 'turn/end', seq: 1, data: { turn: 1 } }];
  const seed = fold(definition, inherited, definition.init({ id: 'synthetic-fork' }, inherited.length));
  const parent = definition.apply(seed, event(2, publication(entries.slice(0, 3))));
  assert.notDeepEqual(parent, seed);
  assert.deepEqual(visibleCatalogProof(seed, [0]), readCatalogProof(inherited[0].data));
  assert.equal(visibleCatalogProof(seed, [2]), undefined);
  const child = definition.apply(seed, event(2, catalog(entries)));
  assert.equal(visibleCatalogProof(child, [0, 2]), undefined);
});

test('many publications retain a constant latest value rather than accumulating entries or sequences', () => {
  const definition = createCatalogProjection();
  let state = definition.init();
  for (let seq = 0; seq < 200; seq++) state = definition.apply(state, event(seq, publication()));
  assert.deepEqual(Object.keys(state), ['latest']);
  assert.deepEqual(Object.keys(state.latest), ['seq', 'proof']);
  assert.equal(state.latest.seq, 199);
  assert.equal(JSON.stringify(state).length < 350, true);
});

test('invalid restored state is rejected rather than producing a reusable proof', () => {
  const schema = createCatalogProjection().stateSchema;
  const valid = { latest: { seq: 1, proof: readCatalogProof(publication()) } };
  for (const state of [
    {},
    { latest: { seq: -1, proof: null } },
    { latest: { seq: 0.5, proof: null } },
    { latest: { seq: 1, proof: {} } },
    { latest: { ...valid.latest, proof: { ...valid.latest.proof, version: 2 } } },
    { latest: { ...valid.latest, proof: { ...valid.latest.proof, rawFingerprint: 'invalid' } } },
  ]) assert.throws(() => schema.parse(state));
});
