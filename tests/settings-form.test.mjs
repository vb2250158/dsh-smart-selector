import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsForm } from '../src/client/settings-form.mjs';
import { Config, SettingsSchema } from '../src/settings.mjs';
import { CONFIG_ENTRY_ID } from '../src/identity.mjs';

test('JSON settings retain rule validation and shared revision-fenced writes', async () => {
  const value = JSON.parse(JSON.stringify(Config(undefined).get()));
  const wireSchema = JSON.parse(JSON.stringify(SettingsSchema.toJSON()));
  let document = { view: { namespaces: [{ ns: CONFIG_ENTRY_ID, value, schema: wireSchema }] } };
  const calls = [];
  const listeners = new Set();
  const form = {
    getSnapshot: () => base,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    mutate: async (ops, revision) => { calls.push({ ops, revision }); return true; },
    set: async () => true,
    unset: async () => true,
  };
  const base = { status: 'unavailable', value: undefined, writable: true, mode: 'host', revision: 3 };
  const mirror = { getSnapshot: () => document, subscribe: form.subscribe };
  const settings = createSettingsForm(form, mirror);
  assert.equal(settings.getSnapshot().status, 'ready');
  assert.deepEqual(settings.getSnapshot().value, value);
  assert.equal(settings.getSnapshot(), settings.getSnapshot());
  const ops = [{ op: 'set', path: ['enabled'], value: false }];
  assert.equal(await settings.mutate(ops, 3), true);
  assert.deepEqual(calls, [{ ops, revision: 3 }]);
  document = { view: { namespaces: [{ ns: CONFIG_ENTRY_ID, value: { ...value, rules: [value.rules[0], value.rules[0]] } }] } };
  assert.equal(settings.getSnapshot().status, 'unavailable');
  assert.equal(settings.getSnapshot().value, undefined);
  const off = settings.subscribe(() => {});
  assert.equal(listeners.size, 1);
  off();
  assert.equal(listeners.size, 0);
});

test('remote memory preferences remain unavailable to Host rule editing', () => {
  const base = { status: 'unavailable', mode: 'memory', writable: false };
  const form = { getSnapshot: () => base };
  const mirror = { getSnapshot: () => ({ view: { namespaces: [{ ns: CONFIG_ENTRY_ID, value: Config(undefined).get() }] } }) };
  assert.equal(createSettingsForm(form, mirror).getSnapshot().status, 'unavailable');
});
