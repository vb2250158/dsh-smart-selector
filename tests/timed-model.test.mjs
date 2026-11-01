import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimedModelStream } from '../src/timed-model.mjs';

test('optional timing labels identify the rule without changing the provider request', async () => {
  const options = { provider: 'fixture', model: 'judge', messages: ['private-input'] };
  const result = { async *[Symbol.asyncIterator]() { yield 'fixture'; } };
  const routed = [], labels = [];
  const llm = { stream(value) { routed.push(value); return result; } };
  const operation = { operation: 'skill-catalog', rules: [{ id: 'skills', title: 'Skill selection' }] };
  const without = createTimedModelStream({ get: () => undefined, llm });
  assert.strictEqual(without(options, operation), result);
  const withTiming = createTimedModelStream({ get: () => ({ stream(label, create) { labels.push(label); return create(); } }), llm });
  assert.strictEqual(withTiming(options, operation), result);
  assert.ok(routed.every(value => value === options));
  assert.deepEqual(labels, [{ plugin: 'dsh-smart-selector', ...operation }]);
  assert.doesNotMatch(JSON.stringify(labels), /private-input|messages/);
});
