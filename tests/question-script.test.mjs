import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuestion } from '../src/question-script.mjs';
import { defaultRules } from '../src/settings.mjs';

test('trusted script can read a file and generate title and labels without changing actions', async () => {
  const rule = { ...defaultRules[0], questionSource: 'script',
    questionScript: "const fs = await import('node:fs/promises'); const name = await fs.readFile('package.json', 'utf8'); return { title: '包名是 ' + JSON.parse(name).name + ' 吗？', options: options.map(x => ({ ...x, label: x.label + '（动态）' })) };" };
  const generated = await generateQuestion(rule, '用户输入');
  assert.match(generated.question, /dsh-smart-selector/);
  assert.match(generated.options[0].label, /动态/);
  assert.equal(generated.options[0].action.text, rule.options[0].action.text);
});

test('script cannot change option identities or behavior and invalid output fails', async () => {
  const rule = { ...defaultRules[0], questionSource: 'script',
    questionScript: "return { title: '题目', options: [{ id: 'other', label: 'X' }, { id: 'no', label: '否' }] };" };
  await assert.rejects(() => generateQuestion(rule, 'x'), /无效选项/);
});

test('ranking question script receives the real event options', async () => {
  const rule = { ...defaultRules[2], questionSource: 'script',
    questionScript: "return { title: '选择相关 Skill', options: options.map(option => ({ id: option.id, label: option.label + '（可评分）' })) };" };
  const candidates = Array.from({ length: 120 }, (_, index) => ({ name: `skill-${index}`, description: `用途 ${index}` }));
  const generated = await generateQuestion(rule, '上下文', undefined, candidates);
  assert.equal(generated.question, '选择相关 Skill');
  assert.equal(generated.candidateOptions.length, 120);
  assert.equal(generated.candidateOptions[119].id, 'skill-119');
  assert.match(generated.candidateOptions[119].label, /可评分/);
});
