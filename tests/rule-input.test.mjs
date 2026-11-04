import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeInput, skillInput, toolFacts, afterInput } from '../src/rule-input.mjs';

const user = text => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
const tool = (toolCallId, content, isError) => ({ role: 'tool', source: { kind: 'tool', callId: toolCallId }, toolCallId, content, isError });

test('canonical tool-role results preserve their call id, recorded status and text without guessing failures', () => {
  const facts = toolFacts([user('current request'),
    tool('tool-normal', [{ type: 'text', text: 'The earlier attempt failed; this attempt succeeded.' }], false),
    tool('tool-failed', [{ type: 'text', text: 'Recorded result' }], true),
    tool('tool-optional-status', [{ type: 'text', text: 'Another result' }]),
  ]);
  assert.deepEqual(facts, [
    { id: 'tool-normal', failed: false, text: 'The earlier attempt failed; this attempt succeeded.' },
    { id: 'tool-failed', failed: true, text: 'Recorded result' },
    { id: 'tool-optional-status', failed: false, text: 'Another result' },
  ]);
});

test('canonical mixed content contributes only its actual text blocks', () => {
  assert.deepEqual(toolFacts([tool('mixed', [
    { type: 'text', text: 'first' }, { type: 'image', data: 'not text' },
    { type: 'text', text: 'second' },
  ], true)]), [{ id: 'mixed', failed: true, text: 'first\nsecond' }]);
});

test('canonical and nested results remain scoped to the latest true user message', () => {
  const nested = (id, text) => ({ source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }] }] });
  const messages = [user('old task'), tool('old-direct', [{ type: 'text', text: 'old result' }], true),
    nested('old-nested', 'old nested result'), user('new task'),
    { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'Tool failed: fabricated claim' }] },
    tool('current-direct', [{ type: 'text', text: 'current result' }], false),
    nested('current-nested', 'current nested result')];
  assert.deepEqual(toolFacts(messages), [
    { id: 'current-direct', failed: false, text: 'current result' },
    { id: 'current-nested', failed: false, text: 'current nested result' },
  ]);
  assert.deepEqual(toolFacts([...messages, user('next task')]), []);
});

test('one call represented by direct and nested results is counted once with canonical fields', () => {
  const direct = tool('same-call', [{ type: 'text', text: 'canonical result' }], false);
  const nested = { content: [{ type: 'tool-result', toolCallId: 'same-call', isError: true,
    content: [{ type: 'text', text: 'alternate representation' }] }] };
  const expected = [{ id: 'same-call', failed: false, text: 'canonical result' }];
  assert.deepEqual(toolFacts([direct, nested]), expected);
  assert.deepEqual(toolFacts([nested, direct]), expected);
  assert.deepEqual(toolFacts([nested, nested]), [
    { id: 'same-call', failed: true, text: 'alternate representation' },
    { id: 'same-call', failed: true, text: 'alternate representation' },
  ]);
  const updated = tool('same-call', [{ type: 'text', text: 'latest canonical result' }], true);
  assert.deepEqual(toolFacts([direct, nested, updated]), [{ id: 'same-call', failed: true, text: 'latest canonical result' }]);
});
test('user-message source takes only the latest user message, while context source takes all visible text', () => {
  const messages = [user('旧消息'), { source: { kind: 'assistant' }, content: [{ type: 'text', text: '助手内容' }] }, user('新消息')];
  assert.equal(beforeInput({ input: 'latest-user-message' }, messages), '新消息');
  assert.equal(beforeInput({ input: 'current-context-text' }, messages), '旧消息\n助手内容\n新消息');
  assert.equal(beforeInput({ input: 'custom-text', customInput: '固定文字' }, messages), '固定文字');
});

test('tool-result source includes actual host failure status and text', () => {
  const messages = [{ content: [{ type: 'tool-result', toolCallId: 'tool-1', isError: true,
    content: [{ type: 'text', text: '失败信息' }] }] }];
  const facts = toolFacts(messages);
  assert.deepEqual(facts, [{ id: 'tool-1', failed: true, text: '失败信息' }]);
  assert.match(afterInput({ input: 'tool-results' }, facts), /失败信息/);
  assert.equal(afterInput({ input: 'custom-text', customInput: '固定' }, facts), '固定');
  assert.deepEqual(toolFacts([messages[0], user('下一轮消息')]), []);
});

test('skill-aware source includes only configured model-invocable skill summaries', () => {
  const rule = { input: 'user-message-with-skills', options: [
    { action: { type: 'inject-skill', text: 'code-review' } },
    { action: { type: 'inject-skill', text: 'private-skill' } },
  ] };
  const skills = [
    { name: 'code-review', description: '检查代码', invocation: { modelInvocable: true } },
    { name: 'private-skill', description: '仅用户调用', invocation: { modelInvocable: false } },
    { name: 'other-skill', description: '无关', invocation: { modelInvocable: true } },
  ];
  assert.deepEqual(JSON.parse(beforeInput(rule, [user('审查这段代码')], skills)), {
    userMessage: '审查这段代码', skills: [{ name: 'code-review', description: '检查代码' }],
  });
  assert.equal(beforeInput(rule, [user('审查这段代码')], []), '');
});

test('skill-injection event inputs use the selected skill and configured source', () => {
  const skill = { name: 'code-review', description: '检查代码', content: '完整操作说明' };
  const messages = [user('检查这个改动')];
  assert.deepEqual(JSON.parse(skillInput({ input: 'skill-summary' }, skill, messages)), {
    userMessage: '检查这个改动', skill: { name: 'code-review', description: '检查代码' },
  });
  assert.deepEqual(JSON.parse(skillInput({ input: 'skill-content' }, skill, messages)), { name: 'code-review', content: '完整操作说明' });
  assert.equal(skillInput({ input: 'latest-user-message' }, skill, messages), '检查这个改动');
  assert.equal(skillInput({ input: 'custom-text', customInput: '固定判断内容' }, skill, messages), '固定判断内容');
});
