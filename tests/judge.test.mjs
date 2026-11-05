import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/judge.mjs';
import { defaultRules } from './fixtures/rules.mjs';

const settings = { provider: 'test', model: 'judge', maxContextCharacters: 2000, rules: [defaultRules[0]] };
const chunks = text => async function* () { yield { type: 'text-delta', index: 0, text }; yield { type: 'finish', reason: { kind: 'stop' } } }();
const createMessage = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });

test('ordinary model sees explicit title, options and selected action only', async () => {
  let request;
  const result = await judge({ settings, phase: 'before', text: '截图显示错误',
    stream: options => { request = options; return chunks('{"answers":{"investigate-before-claim":{"type":"choice","choice":"yes","confidence":0.8,"probabilities":{"yes":0.9,"no":0.1}}}}'); }, createMessage });
  const input = JSON.parse(request.messages[0].content[0].text);
  assert.ok(input.questions['investigate-before-claim'].instructions.endsWith(defaultRules[0].question));
  assert.equal(input.questions['investigate-before-claim'].criteria.yes, defaultRules[0].options[0].label);
  assert.match(result.context, /源码、配置、日志/);
  assert.equal(result.decisions[0].optionId, 'yes');
});

test('invalid verdict and tool calls fail closed', async () => {
  await assert.rejects(() => judge({ settings, phase: 'before', text: 'x', stream: () => chunks('{"answers":{"investigate-before-claim":{"type":"choice","choice":"yes","confidence":0.8,"probabilities":{"yes":2,"no":0}}}}'), createMessage }));
  const stream = async function* () { yield { type: 'tool-call-delta', index: 0, id: 'x', argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } } }();
  await assert.rejects(() => judge({ settings, phase: 'before', text: 'x', stream: () => stream, createMessage }));
});

test('Jev model IDs select native mode without a legacy switch', async () => {
  await assert.rejects(() => judge({ settings: { ...settings, model: 'jev-latest' }, phase: 'before', text: 'x', stream: () => chunks('{}'), createMessage }), /Native decision/);
});


for (const native of [false, true]) test(`${native ? 'native' : 'JSON'} rule questions share identical input and retain distinct input references`, async () => {
  const rules = ['first', 'second', 'third'].map(id => ({ ...defaultRules[0], id }));
  const inputs = { first: 'shared input', second: 'different input', third: 'shared input' };
  const answers = Object.fromEntries(rules.map(rule => [rule.id, { type: 'choice', choice: 'no', probabilities: { yes: 0, no: 1 } }]));
  let request;
  const stream = options => {
    request = JSON.parse(options.messages[0].content[0].text);
    return chunks(JSON.stringify({ answers }));
  };
  stream.decide = async value => { request = value; return { model: value.settings.model, answers }; };
  const result = await judge({ settings: { ...settings, ...(native ? { provider: 'openrouter', model: 'typesafe/jev-1.13' } : {}), rules }, phase: 'before', inputs, stream, createMessage });
  assert.deepEqual(request.state.inputs, ['shared input', 'different input']);
  assert.match(request.questions.first.instructions, /state\.inputs\[0\]/);
  assert.match(request.questions.second.instructions, /state\.inputs\[1\]/);
  assert.match(request.questions.third.instructions, /state\.inputs\[0\]/);
  assert.equal(result.decisions.length, 3);
});
