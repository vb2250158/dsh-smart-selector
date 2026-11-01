import assert from 'node:assert/strict';
import test from 'node:test';
import { providerFixture } from './provider-fixture.mjs';
import { createDecisionClient } from '../src/decisions.mjs';
import { SettingsSchema, defaultRules } from '../src/settings.mjs';
import { judge } from '../src/judge.mjs';
import { rankCatalog } from '../src/catalog-prune.mjs';
import { testChoice } from '../src/choice-test.mjs';

const settings = SettingsSchema({ enabled: true, decisionApi: { enabled: true }, maxContextCharacters: 12000 });
const choice = { type: 'choice', instructions: 'Which?', criteria: { yes: 'Yes', no: 'No' } };
const answer = { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.8 };
const wire = answers => ({ model: 'typesafe/jev-1.13-20260917', answers, usage: { input_tokens: 42, output_tokens: 0 } });
const context = resolve => ({ ...providerFixture(), credentials: { resolve: resolve ?? (async () => ({ value: 'fixture-key' })) } });

test('native probability calls provide separate timing labels without retaining state or credentials', async () => {
  const labels = [], ctx = { ...context(), get: () => ({ request(label, task) { labels.push(label); return task(); } }) };
  let count = 0;
  const decide = createDecisionClient(ctx, async () => { count++; return Response.json(wire({ check: answer })); });
  const operation = { operation: 'before', rules: [{ id: 'input', title: 'Input rule' }] };
  const result = await decide({ settings, state: 'private-input', questions: { check: choice } }, operation);
  assert.equal(count, 1);
  assert.equal(result.answers.check.choice, 'yes');
  assert.deepEqual(labels, [{ plugin: 'dsh-smart-selector', ...operation, provider: settings.provider,
    model: settings.model, transport: 'native-decisions' }]);
  assert.doesNotMatch(JSON.stringify(labels), /private-input|fixture-key|questions|criteria/);
  const failure = new Error('fixture transport failure');
  await assert.rejects(createDecisionClient(ctx, async () => { throw failure; })({ settings, state: 'private-input', questions: { check: choice } }), error => error === failure);
});

test('native requests resolve rotated credentials and send typed questions without chat messages', async () => {
  let key = 'fixture-first';
  const requests = [];
  const decide = createDecisionClient(context(async ref => {
    assert.equal(ref, 'OPENROUTER_API_KEY');
    return { value: key };
  }), async (url, options) => {
    requests.push({ url, ...options });
    return Response.json(wire({ check: answer }));
  });
  const options = { settings, state: 'input', questions: { check: choice } };
  await decide(options);
  key = 'fixture-rotated';
  await decide(options);
  assert.equal(requests[0].url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(requests[1].headers.Authorization, 'Bearer fixture-rotated');
  assert.equal(requests[0].redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].body), { model: settings.decisionApi.model, state: 'input', questions: { check: choice } });
});

test('HTTP failures, refusals and malformed probabilities cannot trigger decisions or expose provider bodies', async () => {
  const options = { settings, state: 'private-input', questions: { check: choice } };
  for (const result of [wire({}), wire({ check: { type: 'refusal' } }), wire({ check: { ...answer, probabilities: { yes: 1, extra: 0 } } }), wire({ check: { ...answer, confidence: 2 } })]) {
    await assert.rejects(createDecisionClient(context(), async () => Response.json(result))(options));
  }
  await assert.rejects(createDecisionClient(context(), async () => new Response('private-input fixture-key', { status: 402 }))(options), error => {
    assert.equal(error.message, 'OpenRouter Decisions HTTP 402');
    return true;
  });
  await assert.rejects(createDecisionClient(context(async () => undefined), async () => { throw new Error('must not fetch'); })(options), /OpenRouter.*凭据/);
  await assert.rejects(createDecisionClient(context(), async () => { throw new Error('must not fetch'); })({ ...options, signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('native rule selection executes the configured action without a text-generation call', async () => {
  const calls = [];
  const rule = defaultRules[0];
  const stream = () => { throw new Error('Native decisions must not use chat generation'); };
  stream.decide = createDecisionClient(context(), async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(wire({ [rule.id]: answer }));
  });
  const result = await judge({ settings: { ...settings, rules: [rule] }, phase: 'before', text: 'purchase failed', stream });
  assert.equal(result.decisions[0].optionId, 'yes');
  assert.match(result.context, /源码/);
  assert.equal(result.scoreKind, 'native-probability');
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions), [rule.id]);
});

test('native candidate filtering batches independent relevance questions and retains the configured threshold and count', async () => {
  const entries = [{ name: 'a', description: 'A' }, { name: 'b', description: 'B' }, { name: 'c', description: 'C' }];
  let request;
  const stream = () => { throw new Error('must not generate'); };
  stream.decide = createDecisionClient(context(), async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json(wire(Object.fromEntries([0.3, 0.95, 0.85].map((noul, index) => [`candidate-${index}`, { type: 'noul', noul }]))));
  });
  const selected = await rankCatalog({ settings, rule: { id: 'skills', title: 'Skills', phase: 'skill-catalog', question: 'Which skills apply?', selectionMode: 'top', selectionValue: '1', threshold: 0.8 }, entries, input: 'purchase failed', stream, signal: new AbortController().signal });
  assert.deepEqual(selected, [entries[1]]);
  assert.equal(Object.keys(request.questions).length, 3);
  assert.ok(Object.values(request.questions).every(question => question.type === 'noul'));
});

test('native test output preserves the provider confidence and served model', async () => {
  const stream = () => { throw new Error('must not generate'); };
  stream.decide = createDecisionClient(context(), async () => Response.json(wire({ choice: { ...answer, choice: 'option-1', probabilities: { 'option-1': 0.9, 'option-2': 0.1 } } })));
  const result = await testChoice({ settings, state: 'input', question: 'Continue?', options: ['Yes', 'No'], stream });
  assert.deepEqual({ mode: result.mode, model: result.model, selected: result.selected, confidence: result.confidence, confidenceKind: result.confidenceKind, options: result.options }, {
    mode: 'jev-native', model: 'typesafe/jev-1.13-20260917', selected: 'option-1', confidence: 0.8, confidenceKind: 'native-confidence',
    options: [{ id: 'option-1', label: 'Yes', probability: 0.9 }, { id: 'option-2', label: 'No', probability: 0.1 }],
  });
});

test('native configuration retires the separate credential reference and retains model defaults', () => {
  assert.equal(SettingsSchema({}).decisionApi.enabled, false);
  assert.equal(Object.hasOwn(SettingsSchema({ decisionApi: { apiKeyRef: 'retired' } }).decisionApi, 'apiKeyRef'), false);
  assert.throws(() => SettingsSchema({ decisionApi: { model: 'ordinary-chat-model' } }));
});


test('native requests expose local timing phases without storing credentials or state', async () => {
  const phases = [];
  const ctx = { ...context(), get: () => ({ request: (_operation, task) => task(), run: async (operation, task) => { phases.push(operation.operation); return task(); } }) };
  await createDecisionClient(ctx, async () => Response.json(wire({ check: answer })))({ settings, state: 'private-input', questions: { check: choice } });
  assert.deepEqual(phases, ['decision-credentials', 'decision-response-headers', 'decision-response-body', 'decision-validation']);
});
