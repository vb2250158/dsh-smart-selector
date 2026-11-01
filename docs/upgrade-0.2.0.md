# 升级到智能选择器 0.2.0

## 变更

插件仓库和包名从 `dsh-jev-context-gate` 改为 [`dsh-smart-selector`](https://github.com/vb2250158/dsh-smart-selector)，界面名称为“智能选择器”。旧仓库和旧版安装保持可用，后续更新在新仓库提供。

配置入口 ID `dsh-jev-context-gate` 保持不变，继续拥有原有规则、启停状态、判定模型、普通文本模型和上下文策略。历史会话事件、技能注入来源和旧设置命名空间也保持原身份。不要重命名或重写会话日志。

新扩展使用 `ctx.smartSelector`，现有 `ctx.jev` 指向同一服务。客户端请求使用 `/api/dsh-smart-selector/`，原 `/api/dsh-jev-context-gate/` 路径保留为同一处理器的兼容入口。JEV、GPT 等名称仍表示具体模型或协议。

原生决策连接沿用 0.1.45 的行为：从“设置 → 模型”读取所选提供商的 API 地址与凭据引用。旧 `decisionApi.apiKeyRef` 不再参与连接选择；已有密钥不被复制或删除。

## 迁移

1. 备份当前 profile 的清单、锁文件和 `cordis.patch.yml`。先在独立 Home 验收新固定 Git 提交。
2. 在插件同步清单中以新仓库的固定 40 位提交替换旧包；`environment.json` 的 `bundles`、`dependencies` 使用新包名，`settingsNamespaces` 继续保留 `dsh-jev-context-gate`。
3. 在 profile 的 `cordis.patch.yml` 中保留 `id: dsh-jev-context-gate`，只将该行的 `name` 改为 `dsh-smart-selector`。保留完整 `config` 和其他元数据，不以新包默认值覆盖已有配置。
4. 通过 DSH 同步器或官方插件 CLI 安装新包并移除旧包。包替换属于一次部署事务，不能同时加载两个版本；需要重启时使用受管停服、备份、冻结安装和恢复流程。
5. 验证旧包已从安装清单与 bundle 列表移除，新包已加载；重新打开“智能选择器”，确认规则、开关、模型和上下文策略保留，并执行受影响的功能验收。

被 Home 或命令行补丁覆盖的配置可能拒绝页面修改；页面会显示未保存错误并保留草稿。先调整覆盖来源再保存，不将拒绝结果显示为保存成功。

以后可通过事件与动作注册接口增加新的智能选择场景。事件提供者负责投递真实输入及应用选择结果；新渠道、外发动作和付费调用仍需各自的配置与授权。
