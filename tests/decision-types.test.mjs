import test from 'node:test';
import { providerFixture } from './provider-fixture.mjs';
import assert from 'node:assert/strict';
import { testChoice } from '../src/choice-test.mjs';
import { judge } from '../src/judge.mjs';
import { rankCatalog } from '../src/catalog-prune.mjs';
import { defaultRules } from './fixtures/rules.mjs';
import { SettingsSchema } from '../src/settings.mjs';
import { createDecisionClient, validateAnswers } from '../src/decisions.mjs';
import { decideQuestions } from '../src/decision-adapter.mjs';

const createMessage = text => ({ content: [{ type: 'text', text }] });
const answers = {
  choice: { type: 'choice', choice: 'option-2', probabilities: { 'option-1': 0.2, 'option-2': 0.8 }, confidence: 0.9 },
  noul: { type: 'noul', noul: 0.8 },
  score: { type: 'score', score: 0.8, probabilities: { '0': 0.2, '1': 0.8 }, confidence: 0.9 },
};
function transport(native, answer) {
  const stream = async function* () { yield { type: 'text-delta', text: JSON.stringify({ answers: { choice: answer } }) }; yield { type: 'finish', reason: { kind: 'stop' } }; };
  stream.decide = createDecisionClient({ ...providerFixture(), credentials: { resolve: async () => ({ value: 'fixture' }) } }, async () => Response.json({ model: 'fixture-served', answers: { choice: answer } }));
  return { stream, settings: native ? SettingsSchema({ decisionApi: { enabled: true } }) : { provider: 'test', model: 'ordinary' } };
}
for (const native of [false, true]) for (const questionType of ['choice', 'noul', 'score']) test(`${native ? 'native' : 'JSON'} executes ${questionType} with shared output semantics`, async () => {
  const result = await testChoice({ ...transport(native, answers[questionType]), questionType, state: 'Synthetic input', question: 'Relevant?', options: ['Low', 'High'], createMessage });
  assert.equal(result.questionType, questionType);
  assert.equal(result.selected, questionType === 'noul' ? 'option-1' : 'option-2');
  assert.equal(result.options[questionType === 'noul' ? 0 : 1].probability, 0.8);
  if (questionType === 'score') assert.equal(result.score, 0.8);
  if (questionType === 'noul') { assert.equal(result.noul, 0.8); assert.equal(result.confidenceKind, 'distribution-concentration'); }
});

test('score expected value selects the nearest ordered action rather than the most likely level', async () => {
  const rule = { ...defaultRules[0], questionType: 'score', threshold: 0, options: ['low', 'middle', 'high'].map(id => ({ id, label: id, action: { type: 'inject-context', text: id } })) };
  const result = await judge({ settings: { provider: 'test', model: 'ordinary', rules: [rule], maxContextCharacters: 12000 }, phase: 'before', text: 'fixture', createMessage,
    stream: async function* () { yield { type: 'text-delta', text: JSON.stringify({ answers: { [rule.id]: { type: 'score', score: 1.1, probabilities: { '0': 0.4, '1': 0.1, '2': 0.5 } } } }) }; yield { type: 'finish', reason: { kind: 'stop' } }; } });
  assert.equal(result.decisions[0].optionId, 'middle');
  assert.equal(result.decisions[0].score, 0.1);
});

test('all candidate types preserve selection semantics and score normalization', async () => {
  const entries = [{ name: 'a', description: 'A' }, { name: 'b', description: 'B' }];
  for (const type of ['choice', 'noul', 'score']) {
    const reply = type === 'choice' ? { selection: { type, choice: 'b', probabilities: { a: 0.2, b: 0.8 } } }
      : Object.fromEntries([0.2, 0.8].map((value, i) => [`candidate-${i}`, type === 'noul' ? { type, noul: value }
        : { type, score: value * 2, probabilities: { '0': 1 - value, '1': 0, '2': value } }]));
    const selected = await rankCatalog({ settings: { provider: 'test', model: 'ordinary' }, rule: { questionType: type, question: 'Relevance', selectionValue: '1', threshold: 0.7 }, entries, input: 'fixture', createMessage,
      stream: async function* () { yield { type: 'text-delta', text: JSON.stringify({ answers: reply }) }; yield { type: 'finish', reason: { kind: 'stop' } }; } });
    assert.deepEqual(selected, [entries[1]]);
  }
});

test('missing score probabilities and inconsistent expected values fail visibly', () => {
  const questions = { q: { type: 'score', criteria: ['low', 'high'] } };
  for (const answer of [{ type: 'score', score: 0.8 }, { ...answers.score, score: 0.1 }, { ...answers.score, probabilities: { '0': 0.2, '2': 0.8 } }])
    assert.throws(() => validateAnswers(questions, { q: answer }), /Invalid decision score|omitted probabilities/);
});

test('old rules retain choice or independent candidate judgement and noul requires exactly two options', () => {
  const settings = SettingsSchema({ rules: defaultRules });
  assert.equal(settings.rules[0].questionType, 'choice');
  assert.equal(settings.rules[2].questionType, 'noul');
  assert.throws(() => SettingsSchema({ rules: [{ ...defaultRules[0], questionType: 'noul', options: [...defaultRules[0].options, { id: 'extra', label: 'Extra', action: { type: 'none', text: '' } }] }] }));
});

test('cancellation between question batches stops later requests', async () => {
  const controller = new AbortController(); let calls = 0;
  const stream = () => { throw new Error('must not generate'); };
  stream.decide = async ({ questions }) => { calls++; controller.abort(); return { model: 'fixture', answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.5 }])) }; };
  await assert.rejects(decideQuestions({ settings: SettingsSchema({ provider: 'openrouter', model: 'openai/gpt-6-luna-decisions' }), state: 'fixture', questions: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'Check' }])), signal: controller.signal, stream }), { name: 'AbortError' });
  assert.equal(calls, 1);
});


for (const questionType of ['choice', 'noul', 'score']) test(`ScaleDown translates ${questionType} state and criteria before the native request`, async () => {
  let payload;
  const stream = () => { throw new Error('must not use chat'); };
  stream.decide = createDecisionClient({ ...providerFixture(), credentials: { resolve: async () => ({ value: 'fixture' }) } }, async (_url, request) => {
    payload = JSON.parse(request.body);
    return Response.json({ model: 'scaledown/classify-1', answers: { choice: answers[questionType] } });
  });
  const result = await testChoice({ settings: SettingsSchema({ provider: 'openrouter', model: 'scaledown/classify-1' }), stream, questionType,
    state: 'Synthetic input', question: 'Relevant?', options: ['Low', 'High'], createMessage });
  assert.deepEqual(payload.state, { text: JSON.stringify('Synthetic input') });
  assert.match(payload.questions.choice.instructions, /JSON encoded in state.text/);
  if (questionType === 'noul') {
    assert.match(payload.questions.choice.instructions, /True means "Low"/);
    assert.match(payload.questions.choice.instructions, /False means "High"/);
    assert.equal(payload.questions.choice.criteria, undefined);
  } else assert.deepEqual(payload.questions.choice.criteria, questionType === 'score' ? ['Low', 'High'] : { 'option-1': 'Low', 'option-2': 'High' });
  assert.equal(result.questionType, questionType);
});

test('ScaleDown score and Jev choice limits fail before a request instead of truncating options', async () => {
  const stream = () => { throw new Error('must not generate'); };
  stream.decide = () => { throw new Error('must not request'); };
  for (const [model, question, message] of [
    ['scaledown/classify-1', { type: 'score', criteria: Array.from({ length: 11 }, (_, i) => String(i)) }, /at most 10 score levels/],
    ['typesafe/jev-1.13', { type: 'choice', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), String(i)])) }, /at most 255 choice options/],
  ]) await assert.rejects(decideQuestions({ settings: SettingsSchema({ provider: 'openrouter', model }), state: { input: 'fixture' }, questions: { q: question }, stream }), message);
});

test('GPT splits 201 independent questions while other native models retain their full request', async () => {
  const questions = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'Check' }]));
  for (const [model, expected] of [['openai/gpt-6-luna-decisions', [200, 1]], ['typesafe/jev-1.13', [201]]]) {
    const sizes = [];
    const stream = () => { throw new Error('must not generate'); };
    stream.decide = async ({ questions: batch }) => { sizes.push(Object.keys(batch).length); return { model, answers: Object.fromEntries(Object.keys(batch).map(id => [id, { type: 'noul', noul: 0.7 }])) }; };
    const result = await decideQuestions({ settings: SettingsSchema({ provider: 'openrouter', model }), state: 'fixture', questions, stream });
    assert.deepEqual(sizes, expected);
    assert.equal(Object.keys(result.answers).length, 201);
  }
});
