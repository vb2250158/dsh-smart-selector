import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDecisionConnection } from '../src/provider-connection.mjs';
import { createDecisionClient } from '../src/decisions.mjs';
import { SettingsSchema } from '../src/settings.mjs';
import { providerFixture } from './provider-fixture.mjs';
import routingSnapshot from './expected/provider-routing.json' with { type: 'json' };

test('native calls follow Models-page credential and endpoint edits without a second Jev setting', async () => {
  let profile = { apiKeyEnv: 'SHARED_ROUTER_KEY', baseURL: 'https://router.example/api/v1/' };
  const refs = [], requests = [];
  const ctx = { ...providerFixture(), credentials: { resolve: async ref => { refs.push(ref); return { value: `synthetic-${ref}` }; } } };
  ctx.settings.describe = () => [{ ns: 'llm-fixture', value: { providers: { openrouter: profile } } }];
  const decide = createDecisionClient(ctx, async (url, request) => {
    requests.push({ url, authorization: request.headers.Authorization });
    return Response.json({ model: 'typesafe/jev-1.13', answers: { check: { type: 'noul', noul: 0.9 } } });
  });
  const input = { settings: SettingsSchema({ provider: 'openrouter', model: 'typesafe/jev-1.13', decisionApi: { apiKeyRef: 'IGNORED_LEGACY_KEY' } }), state: 'Synthetic input', questions: { check: { type: 'noul', instructions: 'Relevant?' } } };
  await decide(input);
  profile = { apiKeyEnv: 'ROTATED_KEY' };
  await decide(input);
  assert.deepEqual(refs, ['SHARED_ROUTER_KEY', 'ROTATED_KEY']);
  assert.deepEqual(requests, routingSnapshot);
});

test('missing provider or credential points to Models and never falls back to a legacy key', async () => {
  const ctx = { ...providerFixture(), credentials: { resolve: async () => undefined } };
  await assert.rejects(resolveDecisionConnection(ctx, 'openrouter'), /设置 → 模型 → OpenRouter/);
  ctx.llm.listConfigurableProviders = () => [];
  await assert.rejects(resolveDecisionConnection(ctx, 'openrouter'), /设置 → 模型/);
  ctx.llm = providerFixture().llm;
  ctx.settings.describe = () => [{ ns: 'llm-fixture', value: { providers: {} } }];
  await assert.rejects(resolveDecisionConnection(ctx, 'openrouter'), /设置 → 模型/);
});

test('Models defaults work while credential-bearing endpoints are rejected without echoing them', async () => {
  const ctx = { ...providerFixture(), credentials: { resolve: async ref => { assert.equal(ref, 'OPENROUTER_API_KEY'); return { value: 'synthetic-key' }; } } };
  assert.equal((await resolveDecisionConnection(ctx, 'openrouter')).endpoint, 'https://openrouter.ai/api/alpha/decisions');
  ctx.settings.describe = () => [{ ns: 'llm-fixture', value: { providers: { openrouter: { baseURL: 'https://synthetic-secret@router.example/v1' } } } }];
  await assert.rejects(resolveDecisionConnection(ctx, 'openrouter'), error => /地址无效/.test(error.message) && !error.message.includes('synthetic-secret'));
});
