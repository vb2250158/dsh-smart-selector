# 0.1.45: shared OpenRouter configuration

智能规则的原生请求改为使用「设置 → 模型」里的 OpenRouter 提供商。原生协议、题型、模型选择、规则和统计保持原行为；兼容模式继续使用所选聊天提供商。

升级前若只有独立的 `decisionApi.apiKeyRef`，在模型页添加 OpenRouter，并填写同一 API 密钥；通过受管设置迁移时，也可将 OpenRouter 的 `apiKeyEnv` 指向原凭据引用，无需复制密钥。已有提供商时以该提供商为准。旧字段不再影响请求，缺少提供商或凭据时，错误直接指向模型页。

另一台电脑通过环境同步恢复提供商配置和加密凭据，再在智能规则选择判定模型。使用该电脑自己的 DSH Home；同步密钥沿用既有安全传递流程。API 地址默认为 `https://openrouter.ai/api/v1`，原生请求使用同一地址下的 `/api/alpha/decisions`；自定义网关必须实现该接口。

Native requests now use the OpenRouter provider on Settings → Models. If an older installation only has `decisionApi.apiKeyRef`, add OpenRouter and enter the same key, or migrate its `apiKeyEnv` to the existing credential reference through managed settings. Existing provider configuration takes precedence; the old field no longer affects requests. Missing configuration points to the Models page. Environment sync transfers the provider and encrypted credentials using the existing sync key. A custom gateway must expose the corresponding `/alpha/decisions` endpoint beside its `/v1` endpoint.
