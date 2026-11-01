/** Synthetic Models-page configuration for native transport tests. */
export function providerFixture() {
  return {
    llm: { listConfigurableProviders: () => [{ provider: 'openrouter', settingsNs: 'llm-fixture', settingsPath: ['providers', 'openrouter'], defaultBaseURL: 'https://openrouter.ai/api/v1' }] },
    settings: { describe: () => [{ ns: 'llm-fixture', value: { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } } }] },
  };
}
