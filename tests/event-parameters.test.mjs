import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_DEFINITIONS, optionParametersForEvent } from '../src/event-parameters.mjs';
import { validateRules } from '../src/policy.mjs';
import { defaultRules } from './fixtures/rules.mjs';

test('event parameter uses a stable key and separate display text', () => {
  const parameter = optionParametersForEvent('skill-catalog')[0];
  assert.deepEqual(parameter, { key: 'skills', display: '当前可用 Skill', kind: 'options' });
  assert.equal(EVENT_DEFINITIONS.find(event => event.key === 'skill-catalog').display, 'Skill 目录准备注入');
  assert.equal(validateRules([defaultRules[2]])[0].candidateParameterKey, parameter.key);
  assert.throws(() => validateRules([{ ...defaultRules[2], candidateParameterKey: 'unknown' }]));
});
