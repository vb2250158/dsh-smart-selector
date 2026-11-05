const noulAnswers = scores => ({ answers: Object.fromEntries(Object.values(scores).map((noul, i) => [`candidate-${i}`, { type: 'noul', noul }])) });
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRegistry } from '../src/capability-registry.mjs';
import { defaultRules } from './fixtures/rules.mjs';
import { SettingsSchema } from '../src/settings.mjs';
import { judge } from '../src/judge.mjs';
import { dispatchToTool } from '../src/dispatch-adapters.mjs';
import { applyEventSelection, selectEventCandidates } from '../src/event-selection.mjs';

const messageRule = () => ({ ...defaultRules[0], id: 'custom-message', phase: 'external', eventKey: 'message.received', eventDisplay: '收到消息',
  input: 'event-param', inputParameterKey: 'text', inputParameterDisplay: '消息正文', question: '这条消息需要转发吗？',
  options: [
    { id: 'yes', label: '需要', action: { type: 'dispatch', text: '转发已确认的内容', params: [
      { key: 'adapter', display: '适配器', value: 'tool' }, { key: 'toolName', display: '工具', value: 'notify' },
      { key: 'messageArgument', display: '消息参数', value: 'text' }, { key: 'arg.destination', display: '目标', value: 'private' },
      { key: 'idempotencyArgument', display: '幂等 ID 参数名', value: 'deliveryId' },
    ] } },
    { id: 'no', label: '不需要', action: { type: 'none', text: '' } },
  ], threshold: 0.8 });

test('external event and action definitions register by key and dispose independently', () => {
  const registry = createCapabilityRegistry();
  const disposeEvent = registry.registerEvent({ key: 'message.received', display: '收到消息', parameters: [{ key: 'text', display: '消息正文' }] });
  const disposeAdapter = registry.registerAdapter({ key: 'notify', display: '发通知', parameters: [] }, async () => {});
  assert.equal(registry.events()[0].parameters[0].key, 'text');
  assert.equal(registry.adapters()[0].display, '发通知');
  assert.throws(() => registry.registerEvent({ key: 'message.received', display: '另一个来源' }));
  disposeEvent();
  disposeAdapter();
  assert.deepEqual(registry.events(), []);
  assert.deepEqual(registry.adapters(), []);
});

test('a configured external event uses an installed non-Rabi tool without group fields', async () => {
  const rule = messageRule();
  const settings = SettingsSchema({ enabled: true, provider: 'mock', model: 'ordinary', rules: [rule] });
  assert.equal(Object.hasOwn(settings.rules[0], 'groupId'), false);
  const calls = [];
  const ctx = {
    tools: { schemas: () => [{ name: 'notify' }], execute: async call => { calls.push(call); return { isError: false, value: { ok: true } }; } },
  };
  const agent = { session: { id: 'session-a' } };
  const outcome = await judge({ settings, phase: 'external', inputs: { 'custom-message': '进度已核实' }, signal: new AbortController().signal,
    createMessage: text => ({ content: [{ type: 'text', text }] }), stream: async function* () {
      yield { type: 'text-delta', text: JSON.stringify({ answers: { 'custom-message': { type: 'choice', choice: 'yes', confidence: 0.95, probabilities: { yes: 0.95, no: 0.05 } } } }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } });
  assert.equal(outcome.decisions[0].status, 'applied');
  await dispatchToTool({ ctx, agent, action: outcome.decisions[0].action, message: '已确认进展', signal: new AbortController().signal,
    internalCalls: new Set(), eventId: 'event-a', ruleId: 'custom-message' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'notify');
  assert.match(calls[0].arguments.deliveryId, /^jev-[a-f0-9]{40}$/);
  assert.equal(calls[0].arguments.destination, 'private');
  assert.equal(calls[0].arguments.text, '已确认进展');
});

test('external event candidates are selected from an event parameter without mutating provider input', async () => {
  const rule = { ...messageRule(), id: 'pick-notices', candidateSource: 'event-params', candidateParameterKey: 'notices',
    candidateParameterDisplay: '注意事项', question: '哪些注意事项与当前内容相关？', selectionMode: 'top', selectionValue: '2',
    selectionAction: 'prune', threshold: 0, options: [] };
  const settings = SettingsSchema({ enabled: true, provider: 'mock', model: 'ordinary', rules: [rule] });
  const original = { text: '当前问题', notices: ['事项一', '事项二', '事项三'] };
  const selected = await selectEventCandidates({ settings, rule, parameters: original, input: original.text,
    signal: new AbortController().signal, createMessage: text => ({ content: [{ type: 'text', text }] }),
    stream: async function* () {
      yield { type: 'text-delta', text: JSON.stringify(noulAnswers({ 'item-1': 0.2, 'item-2': 0.95, 'item-3': 0.8 })) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.deepEqual(selected, [{ id: 'item-2', text: '事项二' }, { id: 'item-3', text: '事项三' }]);
  assert.equal(original.notices.length, 3);
});

test('external event selection applies only a configured prune to returned parameters', () => {
  const original = { notices: ['one', 'two'], text: 'context' };
  const selected = [{ id: 'item-2', text: 'two' }];
  const rule = { id: 'pick-notices', candidateParameterKey: 'notices', selectionAction: 'prune' };
  const pruned = applyEventSelection(original, rule, selected);
  assert.deepEqual(pruned.parameters.notices, selected);
  assert.deepEqual(pruned.selection, { ruleId: 'pick-notices', parameterKey: 'notices', selected });
  assert.deepEqual(original.notices, ['one', 'two']);
  const injected = applyEventSelection(original, { ...rule, selectionAction: 'inject-extra' }, selected);
  assert.deepEqual(injected.parameters, original);
  assert.deepEqual(injected.selection.selected, selected);
});

test('external event accepts a single candidate for scoring', async () => {
  const rule = { ...messageRule(), id: 'single-notice', candidateSource: 'event-params', candidateParameterKey: 'notices',
    selectionMode: 'top', selectionValue: '5', selectionAction: 'prune', threshold: 0, options: [] };
  const settings = SettingsSchema({ enabled: true, provider: 'mock', model: 'ordinary', rules: [rule] });
  const selected = await selectEventCandidates({ settings, rule, parameters: { notices: ['one'] }, input: 'context',
    signal: new AbortController().signal, createMessage: text => ({ content: [{ type: 'text', text }] }),
    stream: async function* () {
      yield { type: 'text-delta', text: JSON.stringify(noulAnswers({ 'item-1': 0.9 })) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.deepEqual(selected, [{ id: 'item-1', text: 'one' }]);
});
