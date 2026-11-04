import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogInput, rankCatalog, pruneCatalogMessage } from '../src/catalog-prune.mjs';
import { defaultRules } from '../src/settings.mjs';

const rule = defaultRules.find(row => row.id === 'skill-trimming');
const entries = Array.from({ length: 12 }, (_, index) => ({ name: `skill-${index}`, description: `用途 ${index}` }));
const signal = new AbortController().signal;
const createMessage = text => ({ content: [{ type: 'text', text }] });
const message = (text, kind = 'user') => ({ source: { kind }, content: [{ type: 'text', text }] });
const visible = events => ({ session: { surface: { nodes: events.map((_, index) => index) }, eventAt: index => events[index] } });

test('current context reserves the current user input before later long instructions and runtime messages', () => {
  const pending = [message('current task'), message('instruction '.repeat(100), 'agent-instructions'),
    message('runtime '.repeat(100), 'runtime-context')];
  const input = catalogInput(rule, visible([]), pending, 64);
  assert.equal(input, `current task\n${pending[2].content[0].text.slice(-51)}`);
  assert.equal(input.length, 64);
});

test('current context fills its remaining budget with recent context in original order', () => {
  const agent = visible([{ type: 'user/message', data: message('old task') },
    { type: 'assistant/message', data: { message: message('previous answer', 'model') } }]);
  const pending = [message('continue'), message('environment', 'runtime-context')];
  assert.equal(catalogInput(rule, agent, pending, 200), 'old task\nprevious answer\ncontinue\nenvironment');
  const budget = 'answer\ncontinue\nenvironment'.length;
  assert.equal(catalogInput(rule, agent, pending, budget), 'answer\ncontinue\nenvironment');
});

test('the most recent real user can come from visible history or pending input', () => {
  const agent = visible([{ type: 'user/message', data: message('surface user') },
    { type: 'assistant/message', data: { message: message('old response', 'model') } }]);
  const later = message('later instructions '.repeat(20), 'agent-instructions');
  assert.match(catalogInput(rule, agent, [later], 40), /^surface user\n/);
  assert.equal(catalogInput({ input: 'latest-user-message' }, agent, [later], 40), 'surface user');
  assert.equal(catalogInput({ input: 'latest-user-message' }, agent, [message('pending user'), later], 40), 'pending user');
  assert.match(catalogInput(rule, agent, [message('pending user'), later], 40), /^pending user\n/);
});

test('current context retains tool text, includes control messages and excludes skill catalogs', () => {
  const tool = { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'tool text' }, { type: 'image', data: 'ignored' }] }] };
  const agent = visible([{ type: 'user/message', data: message('request') },
    { type: 'tool/result', data: { message: tool } },
    { type: 'user/message', data: message('surface catalog', 'skill-catalog') }]);
  const pending = [message('instructions', 'agent-instructions'), message('runtime', 'runtime-context'), message('pending catalog', 'skill-catalog')];
  assert.equal(catalogInput(rule, agent, pending, 100), 'request\ntool text\ninstructions\nruntime');
});

test('custom text, zero budget, empty input and overlong user text keep their existing policies', () => {
  const agent = visible([]);
  assert.equal(catalogInput({ input: 'custom-text', customInput: 'custom contents' }, agent, [], 0), 'custom contents');
  assert.equal(catalogInput(rule, agent, [message('request')], 0), '');
  assert.equal(catalogInput(rule, agent, [], 5), '');
  assert.equal(catalogInput(rule, agent, [message('abcdefgh'), message('later', 'runtime-context')], 4), 'efgh');
  assert.equal(catalogInput({ input: 'latest-user-message' }, agent, [message('abcdefgh')], 4), 'efgh');
  assert.equal(catalogInput({ input: 'latest-user-message' }, agent, [message('instructions', 'agent-instructions')], 20), '');
  assert.equal(catalogInput(rule, agent, [message('old user'), message(''), message('runtime', 'runtime-context')], 7), 'runtime');
});

test('without nonempty current user text the historical tail includes separator boundaries exactly', () => {
  const pending = [message('older', 'agent-instructions'), message('catalog', 'skill-catalog'),
    message('recent', 'runtime-context'), message('')];
  for (let budget = 1; budget <= 15; budget += 1) {
    assert.equal(catalogInput(rule, visible([]), pending, budget), 'older\nrecent'.slice(-budget), `budget ${budget}`);
  }
  for (let budget = 1; budget <= 15; budget += 1) {
    const input = catalogInput(rule, visible([]), [message('user'), message('context', 'runtime-context')], budget);
    assert.ok(input.length <= budget, `user budget ${budget}`);
    assert.ok(input.includes('user'.slice(-budget)), `current user budget ${budget}`);
  }
});

test('bounded current context does not render older message bodies or read history when pending fills its budget', () => {
  const unrenderable = { source: { kind: 'model' }, get content() { throw new Error('older body rendered'); } };
  const agent = visible([{ type: 'assistant/message', data: { message: unrenderable } }]);
  assert.equal(catalogInput(rule, agent, [message('request'), message('context', 'runtime-context')], 15), 'request\ncontext');
  const unreadable = { session: { surface: { nodes: [1] }, eventAt() { throw new Error('older event read'); } } };
  assert.equal(catalogInput(rule, unreadable, [message('long current user')], 4), 'user');
  assert.equal(catalogInput({ input: 'latest-user-message' }, unreadable, [message('request')], 20), 'request');
});

test('Skill 裁剪 uses current visible context and rule-configured count, title and threshold', async () => {
  const agent = { session: { surface: { nodes: [1, 2] }, eventAt: seq => seq === 1
    ? { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '旧任务' }] } }
    : { type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: '已完成' }] } } } } };
  const pending = [{ source: { kind: 'user' }, content: [{ type: 'text', text: '现在检查代码' }] },
    { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: '全部 Skill' }] }];
  const input = catalogInput(rule, agent, pending, 12000);
  assert.match(input, /旧任务[\s\S]*已完成[\s\S]*现在检查代码/);
  assert.doesNotMatch(input, /全部 Skill/);
  const prompts = [];
  const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
    rule: { ...rule, question: '与上下文最相关的 Skill 有哪些？', selectionValue: '3' },
    entries, input, signal, createMessage,
    stream: async function* (options) {
      prompts.push(JSON.parse(options.messages[0].content[0].text));
      yield { type: 'text-delta', text: JSON.stringify({ answers: Object.fromEntries(entries.map((entry, index) => [`candidate-${index}`, { type: 'noul', noul: index / 12 }])) }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.match(prompts[0].questions['candidate-0'].instructions, /与上下文最相关/);
  assert.equal(Object.keys(prompts[0].questions).length, 12);
  assert.deepEqual(selected.map(entry => entry.name), ['skill-11', 'skill-10', 'skill-9']);
  const original = { source: { kind: 'skill-catalog', form: 'catalog', entries }, content: [{ type: 'text', text: '<available_skills>\nall\n</available_skills>' }] };
  const pruned = pruneCatalogMessage(original, selected, value => value);
  assert.equal(pruned.source.entries.length, 3);
  assert.match(pruned.content[0].text, /skill-11/);
  assert.doesNotMatch(pruned.content[0].text, /skill-0/);
  assert.equal(original.source.entries.length, 12);
});

test('invalid catalog ranking never publishes a fabricated selection', async () => {
  await assert.rejects(() => rankCatalog({ settings: { provider: 'test', model: 'ordinary' }, rule, entries,
    input: '任务', signal, createMessage,
    stream: async function* () { yield { type: 'text-delta', text: '{"answers":{"candidate-0":{"type":"noul","noul":1}}}' }; yield { type: 'finish', reason: { kind: 'stop' } }; },
  }), /Invalid decision answers/);
});
