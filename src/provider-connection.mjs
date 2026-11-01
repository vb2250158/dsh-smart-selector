/** Read the same provider profile and credential reference edited by Settings → Models.
 * @param ctx Host services owning the provider directory, settings and credentials.
 * @param provider Selected provider route.
 * @returns The current Decisions endpoint and credential; never retained between requests.
 */
export async function resolveDecisionConnection(ctx, provider) {
  const entry = ctx.llm.listConfigurableProviders().find(row => row.provider === provider);
  const section = entry && ctx.settings.describe().find(row => row.ns === entry.settingsNs);
  const profile = entry?.settingsPath.reduce((value, key) => value?.[key], section?.value);
  if (!profile) throw new Error('请在「设置 → 模型」添加并配置 OpenRouter 提供商。');
  const ref = profile.apiKeyEnv ?? 'OPENROUTER_API_KEY';
  const credential = await ctx.credentials.resolve(ref);
  if (!credential?.value) throw new Error(`OpenRouter 缺少凭据 ${ref}，请在「设置 → 模型 → OpenRouter」填写 API 密钥。`);
  const base = new URL(profile.baseURL ?? entry.defaultBaseURL ?? 'https://openrouter.ai/api/v1');
  if (base.username || base.password || base.search || base.hash || !/^https?:$/.test(base.protocol)) {
    throw new Error('OpenRouter 地址无效，请在「设置 → 模型 → OpenRouter」修改 API 地址。');
  }
  base.pathname = base.pathname.replace(/\/$/, '').replace(/\/v1$/, '') + '/alpha/decisions';
  return { endpoint: base.href, apiKey: credential.value };
}
