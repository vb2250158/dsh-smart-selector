import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from './fixtures/rules.mjs';
import { SettingsSchema } from '../src/settings.mjs';
import { evaluatePolicy, validateRules } from '../src/policy.mjs';
import { matchesTool, toolRuleInput, sendGroupMessage, readGroupReply, startGroupPolling, deliveryIdFor, rabiTimeSeconds } from '../src/tool-automation.mjs';
import { dispatchToRabi } from '../src/dispatch-adapters.mjs';

const configured = (id, overrides = {}) => {
  const base = defaultRules.find(rule => rule.id === id);
  const values = { routeId: 'route-a', targetId: '123', roleId: 'role-a' };
  const fields = { ...base, enabled: true, groupRouteId: 'route-a', groupId: '123', groupRoleId: 'role-a',
    channel: 'napcat', target: 'group', targetId: '123', pollMinutes: 10, maxPolls: 432, ...overrides };
  values.routeId = fields.groupRouteId;
  values.targetId = fields.groupId;
  values.roleId = fields.groupRoleId;
  return { ...fields, options: overrides.options ?? base.options.map(option => option.action.type === 'dispatch' ? { ...option,
    action: { ...option.action, params: option.action.params.map(parameter => Object.hasOwn(values, parameter.key) ? { ...parameter, value: values[parameter.key] } : parameter) } } : option) };
};

test('tool events select exact or prefix tool and high-confidence pre-action denies', () => {
  const rule = configured('rabi-progress', { id: 'deny', phase: 'tool-before', input: 'tool-call',
    options: [{ id: 'stop', label: '阻止', action: { type: 'deny-tool', text: '先核对目标' } }, { id: 'go', label: '继续', action: { type: 'none', text: '' } }] });
  assert.equal(matchesTool(rule, 'rabiroute_manager_api'), true);
  assert.equal(matchesTool(rule, 'bash'), false);
  assert.equal(matchesTool({ toolName: '*' }, 'bash'), true);
  assert.equal(deliveryIdFor('session-a', 'call-a', 'rule-a'), deliveryIdFor('session-a', 'call-a', 'rule-a'));
  assert.notEqual(deliveryIdFor('session-a', 'call-a', 'rule-a'), deliveryIdFor('session-a', 'call-b', 'rule-a'));
  assert.equal(validateRules([rule])[0].toolName, 'rabiroute_*');
  const result = evaluatePolicy({ rules: [rule], phase: 'tool-before', verdicts: { deny: { probabilities: { stop: 0.95, go: 0.05 } } } });
  assert.deepEqual(result.decisions[0].action, { type: 'deny-tool', text: '先核对目标', params: [] });
  assert.equal(evaluatePolicy({ rules: [rule], phase: 'tool-before', verdicts: { deny: { probabilities: { stop: 0.7, go: 0.3 } } } }).decisions[0].status, 'below-threshold');
});

test('tool input chooses call, outcome or visible conversation without trusting a name from tool text', () => {
  const exec = { name: 'rabiroute_manager_api', arguments: { method: 'GET' }, agent: { session: { deriveMessages: () => [{ content: [{ type: 'text', text: '当前问题' }] }] } } };
  const outcome = { isError: false, content: [{ type: 'text', text: '查询结果' }] };
  assert.deepEqual(JSON.parse(toolRuleInput({ input: 'tool-call' }, exec)), { name: exec.name, arguments: JSON.stringify(exec.arguments) });
  assert.match(toolRuleInput({ input: 'tool-result' }, exec, outcome), /查询结果/);
  assert.match(toolRuleInput({ input: 'current-context-text' }, exec, outcome), /当前问题/);
});

test('destination belongs to the selected action and is checked by its adapter', async () => {
  const rule = configured('rabi-progress', { groupId: '' });
  assert.equal(validateRules([rule])[0].options[0].action.params.find(parameter => parameter.key === 'targetId').value, '');
  await assert.rejects(dispatchToRabi({ action: rule.options[0].action }), /missing destination parameters/);
  assert.equal(SettingsSchema({ rules: defaultRules }).rules.length, defaultRules.length);
});

test('a saved Rabi action can target a personal conversation instead of a group', async () => {
  const calls = [];
  const action = structuredClone(configured('rabi-progress').options[0].action);
  const values = { channel: 'personal-channel', target: 'person', targetId: 'user-7', targetIdKey: 'personId' };
  for (const [key, value] of Object.entries(values)) {
    const entry = action.params.find(parameter => parameter.key === key);
    if (entry) entry.value = value;
    else action.params.push({ key, display: key, value });
  }
  const ctx = { tools: { schemas: () => [{ name: 'rabiroute_agent_send' }], execute: async request => {
    calls.push(request);
    return { isError: false, value: { ok: true, body: JSON.stringify({ ok: true, status: 'sent', sentMessageId: 'm-7' }) } };
  } } };
  await dispatchToRabi({ ctx, agent: { session: { id: 'session-a' } }, action, message: '进度已确认', signal: new AbortController().signal,
    internalCalls: new Set(), eventId: 'event-a', ruleId: 'rule-a' });
  const request = JSON.parse(calls[0].arguments.requestJson);
  assert.equal(request.channel, 'personal-channel');
  assert.deepEqual(request.params, { target: 'person', personId: 'user-7', replyToMessageId: '', replyImageDescriptions: [] });
});

test('group send checks Rabi channel receipt and history query accepts only inbound after send', async () => {
  const calls = [];
  const ctx = { tools: { execute: async request => {
    calls.push(request);
    return { isError: false, value: { ok: true, body: JSON.stringify(request.name === 'rabiroute_agent_send'
      ? { ok: true, status: 'sent', sentMessageId: 'm-1' }
      : { code: 0, data: { entries: [{ direction: 'outbound', time: 1001, text: 'bot' }, { direction: 'inbound', time: 1002, text: '答复' }] } }) } };
  } } };
  const agent = { session: { id: 'session-a' } };
  const rule = configured('rabi-unresolved-question');
  const internal = new Set();
  const receipt = await sendGroupMessage({ ctx, agent, rule, message: '需要确认吗？', deliveryId: 'delivery-a', signal: new AbortController().signal, internalCalls: internal });
  assert.equal(receipt.sentMessageId, 'm-1');
  assert.equal(JSON.parse(calls[0].arguments.requestJson).params.groupId, '123');
  assert.equal(JSON.parse(calls[0].arguments.requestJson).sender.sessionId, 'session-a');
  assert.equal(internal.size, 0);
  const reply = await readGroupReply({ ctx, agent, rule, since: 1000, signal: new AbortController().signal, internalCalls: internal });
  assert.equal(reply.text, '答复');
  assert.equal(rabiTimeSeconds(1_600_000_000_900), 1_600_000_000);
  const historyUrl = new URL(calls[1].arguments.path, 'http://local');
  assert.equal(historyUrl.searchParams.get('from'), '1000');
  assert.equal(historyUrl.searchParams.get('adapter'), 'napcat');
  assert.equal(historyUrl.searchParams.get('kind'), 'group');
  assert.equal(historyUrl.searchParams.get('target'), '123');
  assert.equal(historyUrl.searchParams.has('conversationKey'), false);
});

test('manager HTTP success without a sent channel receipt does not count as delivery', async () => {
  const ctx = { tools: { execute: async () => ({ isError: false, value: { ok: true, body: JSON.stringify({ ok: true, status: 'queued' }) } }) } };
  await assert.rejects(sendGroupMessage({ ctx, agent: { session: { id: 'session-a' } }, rule: configured('rabi-progress'), message: '进度', deliveryId: 'delivery-a', signal: new AbortController().signal }), /did not confirm/);
});

test('uncertain send reads the same delivery receipt without resending', async () => {
  const names = [];
  const ctx = { tools: { execute: async request => {
    names.push(request.name);
    if (request.name === 'rabiroute_agent_send') throw new Error('timeout');
    return { isError: false, value: { ok: true, body: JSON.stringify({ ok: true, status: 'sent', sentMessageId: 'm-1' }) } };
  } } };
  const receipt = await sendGroupMessage({ ctx, agent: { session: { id: 'session-a' } }, rule: configured('rabi-progress'), message: '进度', deliveryId: 'delivery-a', signal: new AbortController().signal });
  assert.equal(receipt.sentMessageId, 'm-1');
  assert.deepEqual(names, ['rabiroute_agent_send', 'rabiroute_manager_api']);
});

test('polling schedules configured interval and follows up only after an inbound answer', async () => {
  const scheduled = [], followups = [];
  const ctx = { tools: { execute: async () => ({ isError: false, value: { ok: true, body: JSON.stringify({ code: 0, data: { entries: [{ direction: 'inbound', time: 1002, text: '继续 A', replyToMessageId: 'm-1' }] } }) } }) } };
  startGroupPolling({ ctx, agent: { session: { id: 'session-a' }, followup: value => followups.push(value) }, rule: configured('rabi-unresolved-question'), sentAt: 1000, sentMessageId: 'm-1',
    signal: new AbortController().signal, logger: { warn: () => {} }, createMessage: text => ({ content: [{ type: 'text', text }] }), schedule: (callback, ms) => scheduled.push({ callback, ms }) });
  assert.equal(scheduled[0].ms, 600000);
  await scheduled[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followups.length, 1);
  assert.match(followups[0].content[0].text, /继续 A/);
});

test('unrelated unquoted group chatter keeps the wait active', async () => {
  const scheduled = [], followups = [];
  let reads = 0;
  const ctx = {
    tools: { execute: async () => ({ isError: false, value: { ok: true, body: JSON.stringify({ code: 0, data: { entries: [++reads === 1
      ? { direction: 'inbound', time: 1002, text: '午饭吃什么' }
      : { direction: 'inbound', time: 1003, text: '选 A', replyToMessageId: 'm-1' }] } }) } }) },
    llm: { stream: async function* () { yield { type: 'text-delta', text: '{"probabilities":{"option-1":0.1,"option-2":0.9}}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } },
  };
  startGroupPolling({ ctx, agent: { session: { id: 'session-a' }, followup: value => followups.push(value) }, rule: configured('rabi-unresolved-question'), sentAt: 1000, sentMessageId: 'm-1', questionText: '选 A 还是 B？', settings: { provider: 'mock', model: 'ordinary' },
    signal: new AbortController().signal, logger: { warn: () => {} }, createMessage: text => ({ content: [{ type: 'text', text }] }), schedule: (callback, ms) => scheduled.push({ callback, ms }) });
  scheduled[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followups.length, 0);
  assert.equal(scheduled.length, 2);
  scheduled[1].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followups.length, 1);
});
