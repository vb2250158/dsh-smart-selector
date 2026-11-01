# 更新记录

## 0.2.0

- 新仓库与包名为 `dsh-smart-selector`，界面统一称为“智能选择器 / Smart selector”；旧仓库继续提供原版本。
- 保留配置入口 `dsh-jev-context-gate`、历史事件与来源身份。迁移只替换插件包和入口 `name`，保留规则、开关、判定模型及普通文本模型。
- 扩展服务新增 `smartSelector`，原 `jev` 名称指向同一服务；HTTP 接口使用新前缀并兼容旧前缀。
- Rename the package to `dsh-smart-selector` and present it as Smart selector. Retain existing configuration and persisted identities, and keep legacy service and HTTP aliases.


## 0.1.45

- Jev 与其他原生判定模型复用「设置 → 模型」的 OpenRouter 提供商、API 地址及密钥；移除独立凭据字段，保留判定选择和规则行为。
- Native decisions use the OpenRouter profile and credential edited on Settings → Models. Retire the separate credential field; preserve decision selection and rule behavior.

## 0.1.44

- 判定模型使用聊天会话同一套模型选择器，复用常用模型、搜索和提供商分组；选择结果只保存到智能规则。
- 设置界面依赖模型与推理选择插件 0.1.18 或以上。原生决策模型与普通兼容模型保留在同一目录，三种题型和既有规则不变。
- Use the chat model selector for independent decision settings, including shared recent models, search, and provider groups. Requires Model & reasoning selector 0.1.18 or later; selecting a decision model preserves the chat selection.

## 0.1.43

- 统一选择题、判断题、评分题；规则编辑器顶部和测试页可选，原生与 JSON 兼容模式共享配置与结果处理。
- 新增 DecisionAdapter 父类、通用 OpenRouter 原生模型目录和 ScaleDown 输入适配；普通聊天模型继续使用三题型 JSON 估计。
- 保留旧普通规则的 Choice 和候选规则的 Noul 行为；评分按期望等级处理，缺失必需概率明确失败。
- 原生请求提供凭据读取、响应头等待、响应体读取、校验分段计时；按模型协议限制分批并响应取消。
- Add bilingual model capability documentation, a catalog audit script, and keyless CI tests/build. Native provider coverage is protocol-tested; the model inventory is documentation-verified, not a live inference benchmark.

## 0.1.42

- Candidate selection writes validated scores, ranks, chosen candidates and rule parameters to an ignorable catalog-selection session event, correlated with timings by selectionId. It excludes conversation, question text and skill bodies; diagnostic failure does not change the selection.

## 0.1.41

- 增加可选的输入预处理内部计时：规则、候选来源、问题生成和技能快照；保留判定和注入行为。
- Add optional own-work preprocessing timings for rules, candidate sources, question generation and skill snapshots without changing decisions or injections.


## 0.1.40

- 原生和普通模型统一到原判定模型下拉，原生概率模型前置，普通模型标注“兼容模式”，移除独立原生开关。
- 迁移既有原生配置，保留普通模型文本生成；新增切换、排序与配置回归。
- Use one decision-model picker for native and ordinary models, prioritize native probabilities and label ordinary models as compatibility mode and migrate existing selections.


## 0.1.39

- 修正限制说明中仍称原生 Jev 尚未接入的旧文字。
- Remove the obsolete limitation claiming native Jev was not integrated.

## 0.1.38

- 接入 OpenRouter Jev 原生 Choice/Noul 判定，覆盖规则、候选筛选、回复匹配和单题测试；保留普通模型消息生成。
- 从 DSH 凭据库逐次解析密钥，隔离服务端错误正文；失败和无效概率不触发动作。
- 测试页区分原生置信度与普通模型集中度，并新增原生请求、凭据轮换、规则及筛选回归验证。
- Add native OpenRouter Jev decisions, credential rotation, typed-response validation and test-page confidence. Ordinary models still generate message text. Native requests are not yet included in individual LLM-call statistics.

## 0.1.37

- 向可选会话计时服务提供逐次模型调用的用途、规则名称与 ID；不修改提供方参数或判断行为。
- Label each model call with its purpose and configured rule names and IDs through the optional timing service, without changing provider requests or rule decisions.

## 0.1.36

- 压缩后在同一次请求中恢复完整项目指令和技能目录；相同文件版本与正文的重复批次撤下并计量。
- 保持基线、修改及删除通知顺序；技能目录保留正文按需加载指引。
- Restore complete workspace instructions and catalogs before the compacted request freezes; deduplicate exact file-version batches with logged accounting. Preserve baseline, update, and removal order and skill-loading guidance.

## 0.1.35

- 最新状态依据发布序号确定，兼容表面头部替换；复制会话保留完整原文并重绑查询序号。
- 目录不假定资源类型，也不扩张已简短的输入；预览明确替代旧状态。
- Order state by publication and preserve complete captured text across session copies; keep catalogs generic and avoid expanding short input.

## 0.1.34

- 安装组合显式声明 tokenMeter，与插件依赖保持一致；宿主补丁说明符合文档预算。
- Declare tokenMeter in the installed composition and keep host patch documentation within repository budgets.

## 0.1.32

- 统一快照生命周期、完整请求预算和压缩目标；完整状态通过 context_read 分页查询。
- 宿主补丁随插件发布，开启策略前检查驱动能力。
- Shared snapshot lifecycle, admitted-request pressure budgets, and compaction targets; full detail is paged through context_read.
- Ships and checks the required host patch.

## 0.1.31 (2026-10-07)

- 缩小图标绘制内容约三分之一，增加方框内的留白。
- Reduce icon artwork by one third with a centered, padded viewBox.

## 0.1.30 — 2026-10-07

- Open this plugin from the Plugins list to access its existing configuration and controls. Settings no longer duplicates its navigation entry.
- 在插件列表中点击本插件进入详情页，即可使用原有配置和操作界面；设置菜单不再重复显示该插件入口。

## 0.1.29 (2026-10-07)

- 为插件列表提供中英文名称与说明，并发布独立的 SVG 图标。
- Publish English and Chinese plugin display metadata and a dedicated SVG icon.

## 0.1.28

- 浏览器从共享设置镜像读取规则，使用插件自带的规则校验与迁移代码；保存继续使用 DSH 的有序写入和版本检查，修复 JSON 传输无法携带规则校验函数导致的页面不可用。

## 0.1.27

- 未填写插件配置时提供默认规则设置，修复配置页无法加载及运行时读取空值的问题。

## 0.1.26

- 按 DSH 0.2 的插件入口 ID 读取和保存设置，修复智能规则配置页显示“设置不可用”。

## 0.1.25

- 将设置菜单、页面标题及插件操作说明中的 Jev 名称改为“智能规则”；保留包名、配置键和原生模型名称。

## 0.1.24

- Include the schema build dependency when pnpm prepares the Git package.

## 0.1.23

- Update DSH compatibility requirements and interfaces for 0.2.1-alpha.1.

## 0.1.22

- 修正扩展事件选项行为：仅“裁剪”替换返回参数，“注入额外内容”保留原候选并继续返回入选结果；事件候选允许只有一项。
- 规则编辑器明确提示扩展事件的裁剪结果由事件提供者应用。

## 0.1.21

- 把旧工作群目标从规则顶层迁移到选项动作参数；新增可编辑的动作适配器与参数 key／显示名，支持已安装工具和可选 Rabi 适配器。
- 新增可自行填写 key 和显示名的扩展事件规则，以及事件／动作适配器注册与投递接口；未连接提供者的事件明确标记为不会触发。
- 保留两条工作群预置规则作为可修改的数据配置，移除规则编辑区固定的工作群目标面板。
- 扩展事件可把指定参数中的任意候选列表作为选项一次评分；规则配置筛选数量及裁剪或补充内容，事件提供者收到裁剪后的参数和逐规则结果。
- 通用工具动作可配置幂等 ID 参数名；相同会话、事件和规则会生成相同投递 ID。

## 0.1.20

- 修复工作群回访：按 Rabi 历史接口的秒级时间查询，并用渠道、群类型和群 ID 精确筛选，兼容带网关前缀的会话键。
- 发送与回执使用 Rabi 实际响应格式校验；确认渠道已发送后才进入回访等待。

## 0.1.19

- 修复浏览器插件入口加载失败：将设置校验依赖打包进客户端，避免宿主模块表缺少 `@deepseek-ai/schemastery` 时整页无法加载。

## 0.1.18

- 新增工具调用前、调用后事件；规则按具体工具名或名称前缀选择监听对象。高置信度选项可在调用前拒绝工具，调用后可补充主会话上下文。
- 新增“工作群进度更新”和“工作群提问并等待”两条预置规则。群消息通过 Rabi 正式发送工具提交并核对渠道回执；提问后按规则间隔读取群历史，默认每 10 分钟一次，收到新入站消息后继续原会话。
- 群 Route、群 ID、人格 ID、检查间隔及次数均由规则配置。预置群规则默认关闭，填写精确目标后才能启用；旧设置打开规则页时补入两条预置规则。

## 0.1.17

- 动态候选一次提交全部选项并校验每项评分，支持评分区间、前 N 项和后 N 项，不再按 100 项分批或对入围项复评。
- 候选可来自待判断内容的分隔结果、固定列表、脚本或事件参数；事件参数的稳定 `key` 与界面 `display` 分开保存和展示。
- 动态规则可配置筛选后的裁剪或额外内容注入；“Skill 裁剪”默认选择目录事件的 `skills` 参数并保留评分前 10 项。

## 0.1.16

- 候选筛选复用同一套相关度评分：规则可使用宿主 Skill 目录、逐行配置的候选内容，或本机脚本生成的候选数组；自定义候选入选后注入当前会话。
- “最多保留多少条”直接显示在规则编辑弹窗中，修改 10 为 5 后按新的数量裁剪；候选数量小于保留数量时仍执行相关度与阈值判断。
- 100 条候选在一批模型请求中评分；超过一批时分批评分并对入围项复评。候选来源、题目、输入、阈值和保留数量均由规则保存。

## 0.1.15

- 规则列表只显示可配置标题和说明，不再显示“规则 1/2/3”、事件标签和题目摘要；旧规则缺少标题时用说明作为列表名称。
- 点击“编辑”打开独立弹窗；保存成功后关闭，取消或按 Escape 会撤销本次编辑，长表单在弹窗中滚动。

## 0.1.14

- 新增可配置“Skill 裁剪”规则：在宿主 Skill 简介目录注入前，依据当前上下文对动态候选项评分，默认仅保留前 10 条；题目、阈值、数量与启停均来自规则数据。
- 前置选项可选择“注入 Skill 正文”并配置 Skill 名称；通过 DSH Skill 服务加载，限制为模型可调用 Skill，并按可见会话内容去重。
- 新增数据驱动的“Skill 准备注入”事件。规则可自行选择待判断内容、题目、选项、阈值，以及继续、跳过或附加上下文行为；判定不可用时不注入该候选 Skill。

## 0.1.13

- 规则标题和规则说明分别可编辑、保存并在规则卡片上显示；旧规则可补填标题。
- 规则默认收起，每次只展开一条；事件与内容来源并排配置，选项动作参数按需展开，保存操作固定在规则列表上方。

## 0.1.12

- 规则说明可在编辑区修改、保存，并在收起的规则卡片上显示。旧规则没有说明时可直接补写。
- 收紧规则编辑区间距；运行时内容与脚本接口说明按需展开。
