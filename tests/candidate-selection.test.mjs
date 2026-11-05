const noulAnswers = scores => ({ answers: Object.fromEntries(Object.values(scores).map((noul, i) => [`candidate-${i}`, { type: 'noul', noul }])) });
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidates } from '../src/candidate-source.mjs';
import { rankCatalog } from '../src/catalog-prune.mjs';
import { validateRules } from '../src/policy.mjs';
import { defaultRules } from './fixtures/rules.mjs';

const signal = new AbortController().signal;
const base = defaultRules[2];
const manualRule = {
  ...base, id: 'notice-selection', title: '注意事项裁剪', phase: 'before', candidateSource: 'custom-list',
  candidateText: Array.from({ length: 100 }, (_, index) => `注意事项 ${index + 1}`).join('\n'),
  options: [
    { id: 'selected', label: '入选', action: { type: 'inject-selected-candidates', text: '10' } },
    { id: 'other', label: '未入选', action: { type: 'none', text: '' } },
  ],
};
const createMessage = text => ({ content: [{ type: 'text', text }] });

test('100 configured notices are ranked in one model request and the saved limit selects 10 or 5', async () => {
  const rule = validateRules([manualRule])[0];
  const entries = await resolveCandidates(rule, '当前内容', signal);
  assert.equal(entries.length, 100);
  for (const limit of [10, 5]) {
    const prompts = [];
    const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
      rule: { ...rule, selectionValue: String(limit) },
      entries, input: '当前内容', signal, createMessage,
      stream: async function* (options) {
        prompts.push(JSON.parse(options.messages[0].content[0].text));
        yield { type: 'text-delta', text: JSON.stringify(noulAnswers(Object.fromEntries(entries.map((entry, index) => [entry.name, index / 100])))) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    });
    assert.equal(prompts.length, 1);
    assert.equal(Object.keys(prompts[0].questions).length, 100);
    assert.equal(Object.values(prompts[0].state.candidates)[0], '注意事项 1');
    assert.equal(selected.length, limit);
    assert.equal(selected[0].description, '注意事项 100');
  }
});

test('trusted candidate script can generate items and invalid lists fail before scoring', async () => {
  const rule = validateRules([{ ...manualRule, candidateSource: 'script', candidateScript: "return ['第一条', '第二条', '第三条']" }])[0];
  assert.deepEqual((await resolveCandidates(rule, '内容', signal)).map(row => row.description), ['第一条', '第二条', '第三条']);
  await assert.rejects(() => resolveCandidates({ ...rule, candidateScript: "return [{ id: 'same', text: '一' }, { id: 'same', text: '二' }]" }, '内容', signal), /候选项 ID/);
  assert.throws(() => validateRules([{ ...manualRule, options: [{ ...manualRule.options[0], action: { type: 'none', text: '' } }, manualRule.options[1]] }]));
});

test('more than 200 candidates remain in one ordinary-model request and threshold still applies', async () => {
  const entries = Array.from({ length: 220 }, (_, index) => ({ name: `item-${index + 1}`, description: `注意事项 ${index + 1}` }));
  const sizes = [];
  const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
    rule: { ...manualRule, threshold: 0.8, selectionValue: '5' },
    entries, input: '当前内容', signal, createMessage,
    stream: async function* (options) {
      const prompt = JSON.parse(options.messages[0].content[0].text);
      const candidates = Object.keys(prompt.questions).map(id => ({ id: `item-${Number(id.slice(10)) + 1}`, questionId: id }));
      sizes.push(candidates.length);
      yield { type: 'text-delta', text: JSON.stringify({ answers: Object.fromEntries(candidates.map(row => [row.questionId, { type: 'noul', noul: Number(row.id.slice(5)) / 220 }])) }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.deepEqual(sizes, [220]);
  assert.deepEqual(selected.map(row => row.name), ['item-220', 'item-219', 'item-218', 'item-217', 'item-216']);
  const short = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
    rule: { ...manualRule, threshold: 0.8 }, entries: entries.slice(0, 3), input: '当前内容', signal, createMessage,
    stream: async function* (options) {
      const prompt = JSON.parse(options.messages[0].content[0].text);
      const candidates = Object.keys(prompt.questions).map(id => ({ id: `item-${Number(id.slice(10)) + 1}`, questionId: id }));
      yield { type: 'text-delta', text: JSON.stringify(noulAnswers(Object.fromEntries(candidates.map(row => [row.id, 0.2])))) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.deepEqual(short, []);
});

test('selected input can supply one option per line without a candidate count cap', async () => {
  const input = Array.from({ length: 550 }, (_, index) => `注意事项 ${index + 1}`).join('\n');
  const rule = validateRules([{ ...manualRule, candidateSource: 'input-split', candidateText: '' }])[0];
  const entries = await resolveCandidates(rule, input, signal);
  assert.equal(entries.length, 550);
  const prompts = [];
  const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' }, rule,
    entries, input, signal, createMessage,
    stream: async function* (options) {
      const prompt = JSON.parse(options.messages[0].content[0].text);
      prompts.push(prompt);
      yield { type: 'text-delta', text: JSON.stringify({ answers: Object.fromEntries(Object.keys(prompt.questions).map(id => [id, { type: 'noul', noul: Number(id.slice(10)) / 550 }])) }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts.map(prompt => Object.keys(prompt.questions).length), [550]);
  assert.equal(selected.length, 10);
  assert.equal(selected[0].description, '注意事项 550');
});

test('space and literal separators create options from the selected input', async () => {
  const baseRule = validateRules([{ ...manualRule, candidateSource: 'input-split' }])[0];
  assert.deepEqual((await resolveCandidates({ ...baseRule, splitMode: 'space' }, '甲 乙   丙', signal)).map(row => row.description), ['甲', '乙', '丙']);
  assert.deepEqual((await resolveCandidates({ ...baseRule, splitMode: 'literal', splitText: '||' }, '甲||乙||丙', signal)).map(row => row.description), ['甲', '乙', '丙']);
});

test('score thresholds and bottom count select the configured subset', async () => {
  const entries = ['甲', '乙', '丙', '丁'].map((description, index) => ({ name: `item-${index + 1}`, description }));
  const scores = { 'item-1': 0.1, 'item-2': 0.4, 'item-3': 0.7, 'item-4': 0.9 };
  const stream = async function* () {
    yield { type: 'text-delta', text: JSON.stringify(noulAnswers(scores)) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  for (const [selectionMode, selectionValue, expected] of [
    ['score-below', '50', ['乙', '甲']], ['score-above', '50', ['丁', '丙']], ['bottom', '2', ['乙', '甲']],
  ]) {
    const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
      rule: { ...manualRule, selectionMode, selectionValue }, entries, input: '内容', signal, createMessage, stream });
    assert.deepEqual(selected.map(row => row.description), expected);
  }
});

test('score-above 50 excludes exactly 50 and keeps every qualifying candidate beyond ten', async () => {
  const scores = [0.49, 0.5, ...Array.from({ length: 12 }, (_, index) => 0.51 + index / 100)];
  const entries = scores.map((_, index) => ({ name: `item-${index}`, description: `candidate ${index}` }));
  let calls = 0;
  const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' },
    rule: { ...base, selectionMode: 'score-above', selectionValue: '50' }, entries, input: 'current task', signal, createMessage,
    stream: async function* () {
      calls++;
      yield { type: 'text-delta', text: JSON.stringify(noulAnswers(scores)) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(selected.length, 12);
  assert.deepEqual(selected.map(entry => entry.name), entries.slice(2).reverse().map(entry => entry.name));
});
