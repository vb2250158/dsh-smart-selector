# Smart Selector

`dsh-smart-selector` succeeds `dsh-jev-context-gate`. It uses an independent model to judge event inputs, select candidates and execute configured actions. Supported backends include native decision models from JEV, GPT and other families, plus ordinary chat models. Read the [migration guide](docs/upgrade-0.2.0_en.md) before replacing the old plugin.

English | [简体中文](README.md)

Smart Selector for DSH (package `dsh-smart-selector`). Plugins → Smart selector configures event judgements, content selection, and actions; DSH 0.2 reads and writes configuration by the plugin entry ID `dsh-jev-context-gate`. A separate judge model reads selected event content, answers the configured question type, and activates the action owned by the selected option. Ordinary models use LLM JSON estimates. Select a supported native OpenRouter decision model in the same dropdown to use the Decisions API. Ordinary models remain responsible for actions that generate text.

## Three question types

Choose Choice, Noul, or Score at the top of the rule editor and on the test page. Native and JSON compatibility transports share configuration and answer handling. Compatibility probabilities are uncalibrated model estimates.

| Type | Ordinary rules | Candidate selection |
| --- | --- | --- |
| Choice | Select one option and apply its probability threshold | Compare candidates in one probability distribution |
| Noul | Exactly two options: yes first, no second | Judge each candidate independently |
| Score | Order options low to high; choose the nearest expected level and apply that level's probability threshold | Grade each candidate against configured ordered levels and normalize its expected level to 0–100% |

Existing rules retain their behavior: Choice for ordinary rules and Noul for candidates. Switching type preserves options and actions; Noul requires two options before saving. Native requests use each model's declared question limit (200 for GPT); cancellation prevents later batches. Mutually exclusive options are never split into independent Choice questions.

See [native model support](docs/native-models_en.md) for the reviewed OpenRouter catalog and specialized protocols. Ordinary chat models support all three types through JSON compatibility. Text-generation actions continue to use `messageModel`.

Native request diagnostics include credential resolution, response-header wait, response-body reading, and validation when the statistics plugin is installed. Header wait includes network and server waiting; it does not isolate inference time. Missing confidence is labeled as distribution concentration; missing required probabilities fail visibly without fabricated distributions or automatic paid fallback requests.

## Native decision configuration

Plugins → Smart selector uses the same model chooser as chat, including recent models, search, and provider groups. Ordinary models carry a compatibility-mode label; native decision models use the Decisions API. Selection saves the independent decision model and preserves the chat model.

The settings interface requires Model & reasoning selector (`dsh-codex-model-selector`) 0.1.18 or later. Upgrade that plugin before Smart selector, then refresh the page. Existing rules require no manual migration.

Add OpenRouter under Settings → Models → Add model provider and enter its API key, or edit the existing provider. Smart selector read that provider's `apiKeyEnv` credential reference and API URL on each call; there is no separate Jev key. The independent `provider`/`model` decision selection and `decisionApi.timeoutMs` remain. The former `decisionApi.apiKeyRef` is retired; see the [0.1.45 upgrade guide](docs/upgrade-0.1.45.md). Settings from 0.1.38–0.1.39 still migrate to the OpenRouter selection and retain the previous ordinary model in `messageModel` for text-generation actions. A text-generation action fails explicitly if native selection has no saved ordinary text model.

The selected question type controls native and compatibility requests. Failed or refused requests and invalid probabilities do not activate actions or silently fall back. Native calls participate in the optional statistics service.

## Context lifecycle policy

Version 0.1.37 optionally labels each auxiliary model call for Chat Enhancement 0.3.77 statistics. Expand individual calls to distinguish candidate selection, input classification, skill injection, tool checks and response checks, including configured rule names and IDs. Labels stay outside provider requests and exclude questions, inputs, candidate content and responses. Without the statistics plugin, model calls use their original entry.

State previews shorten structured arrays without truncating unparsed facts or authorization text. If the preview cannot meet its budget, the original remains for ordinary compaction.

Publication order determines the latest value even after a surface-head replacement. Session copies bind reads to local sequence numbers; runtime state reuses its complete logged sections and other views carry captured text. Legacy copies missing their original stay visible and require a source refresh before full-detail reads.

`contextPolicy` is enabled independently of model judgement. Snapshot and catalog identity is the session-local tuple of `source.kind`, `source.plugin`, `source.contextKey`, and `source.form`. Only the latest `snapshot` or `catalog` remains active; ordinary user messages are preserved. Producers with several values use distinct context keys. Metered empty developer replacements retire old nodes while preserving the original log. Large state receives array counts and previews; catalogs keep every name with shorter descriptions. `context_read` retrieves the exact original by logged sequence with pagination.

Workspace instruction deduplication requires equal full batches from `agent-instructions`: file identities, digests, source metadata, and text must match. Other instruction producers and distinct versions remain untouched. Checkpoint summaries never count as full rules. After successful compaction, the ready hook logs missing catalogs and instructions before the same request freezes. A partially retained instruction chain is republished in its original baseline, update, and removal order. The instruction provider retains ownership of discovery and file budgets.

Policy runs after the actual route, complete input, and tools have been logged, before pressure compaction. Thresholds use the smaller of the window fraction and capacity minus effective output reservation and proportional headroom. Compaction targets and verbatim retention scale with the remaining message budget. Defaults are threshold ratio `0.8`, headroom ratio `0.06`, target ratio `0.4`, retention ratio `0.16`, snapshot preview 12000 characters, catalog descriptions 96 characters, three preview items, and detail pages of 4096 characters. Configure these under `contextPolicy`. Output reservation remains adapter-declared; local output settings do not imply provider enforcement.

Apply the [host patch](patches/2026-10-10-request-context-policy.patch) and rebuild the affected Host packages before enabling this policy. The patch supplies request reconciliation, bound capacity, pressure-policy hooks, and original snapshot recognition; this plugin owns policy. Follow the [patch instructions](patches/README.md), check the required baseline and preceding patches, then run `git apply --check`. Recheck after upstream updates. An unpatched driver rejects enabled policy; `contextPolicy.enabled: false` retains existing judge rules. Unload disposes tools and listeners; durable replacements remain replayable.

## 0.1.22

External-event candidate parameters may contain a single item. `emit()` replaces a candidate parameter in the returned `parameters` only when the rule selects “Trim.” “Inject extra content” leaves that parameter intact and still returns the selected entries in `selections`. The event provider applies the returned parameters to the content it owns.

## 0.1.21

Events, judged input, and action targets are configured separately. An “External event” rule stores a stable event key, display name, and the key of the event parameter to judge. Connected event sources expose their parameters with separate keys and display names. A rule with no connected source can be saved but does not fire. A source may provide group messages, direct messages, or daily records by emitting a stable event ID, an Agent, and named parameters; Jev does not claim to monitor a channel that has no source.

“Dispatch external action” belongs to a selected option. Its parameters have independently saved keys and display names. The built-in `tool` adapter can call any installed tool, placing the composed message in a configured argument and passing `arg.*` values as additional arguments. `rabi` is an optional adapter: channel, recipient kind and ID, Route ID, reply wait, and polling interval are option parameters. Rabi can be absent without preventing other rules from loading. Previously saved group fields migrate to option parameters on read. Both supplied rules can change their event, watched tool, question, options, and action.

An extension plugin registers an event with `ctx.inject(['smartSelector'], scope => scope.smartSelector.registerEvent({ key, display, parameters }))`, then emits it using `scope.smartSelector.emit({ key, id, agent, parameters, signal })`; registration returns a disposer. Adapters register with `scope.smartSelector.registerAdapter({ key, display, parameters }, handler)`. Parameter definitions have stable `key` and independent `display` fields, with optional `required`, `kind`, and `defaultValue`. This release does not ship an inbound group-message source. A message-source plugin must register and emit that event. Reply polling remains process-local and does not resume after restart.

An external-event rule can use an event parameter as its options. The provider supplies an array of strings or `{ id, text }` entries; one model request scores them all, and the saved threshold or top/bottom count selects the result. `emit()` returns processed `parameters` and per-rule `selections`. The event provider applies the returned data to the event it owns. Candidate text is limited to 64,000 characters; the model's input and output capacity sets the practical item count.

The generic tool action accepts `toolName`, `messageArgument`, and any `arg.<tool argument>` parameters. If the target tool supports deduplication, set `idempotencyArgument` to its argument name. The same session, event, and rule produce the same ID; the target tool owns deduplication.

## 0.1.20

Tool-before and tool-after events can match an exact tool name, a prefix such as `rabiroute_*`, or all tools. A selected before action may deny dispatch. An after action may attach context or send a work-group progress update or question through Rabi.

Two disabled presets, “Work-group progress update” and “Ask work group and wait,” judge Rabi tool outcomes. Configure the exact Route ID, group ID, and role ID before enabling them. The selected action's editable instruction and event facts produce a short message; `rabiroute_agent_send` must confirm a sent channel receipt. The question rule queries new inbound group messages through `rabiroute_manager_api` every ten minutes by default. A quoted reply resumes the original session; an unquoted message is first judged for relevance. The interval and maximum polls are editable. Polling lives in the current DSH process and ends on restart.

## 0.1.17

Dynamic selection sends all candidates in one model request, requires a 0–1 score for each, then selects the top N, bottom N, scores above N%, or scores below N%. There is no fixed 100-item batch cap; the provider must still accommodate the full input and output. The legacy minimum relevance score remains editable under the additional minimum score control.

Option sources include manual configuration, splitting judgement input by newline, space, or a specified string, a fixed line-delimited list, and a trusted script. Dynamic actions may trim candidates or inject additional content. Trimming on the before event injects the selected subset while preserving the original user message. The Skill catalog event exposes its `skills` parameter as options; the UI displays “Current available Skills” while settings save the stable parameter `key`, separate from its localizable `display`. Catalog trimming returns selected entries to the event and replaces that catalog. The default Skill trimming rule keeps the top 10, and the count is editable.

## 0.1.16

The rule editor now exposes the top count directly. Change Skill trimming from 10 to 5 there. Candidate scoring places the questions in one request or model-limited batches; it does not send a separate request for each Skill or run a finalist pass. The relevance threshold applies even when the candidate count is below the top count.

For a custom list, add a rule for the user-message event, choose custom candidate filtering, enter one item per line, and configure the judgement input, question, threshold, and top count. Selected items enter the current conversation. A candidate script can instead return strings or `{ id, text }` entries and may read local files. Lists contain 2–500 items, at most 64000 characters in total; the top count is 1–50.

## 0.1.15

The rule list shows each configured title and description without generated rule numbers or extra summary tags. Edit opens a separate dialog for the event, input, question, and option actions. Save persists the changes; Cancel discards edits made in that dialog. If an older rule has no title, its description names the list item; if both are empty, it appears as an unnamed rule.

## 0.1.14

The configured “Skill trimming” rule handles the host Skill catalog before injection. It reads visible conversation context, asks “Which Skills are most relevant to the current context?”, derives candidate options from available Skill names and descriptions, and keeps the top 10 summaries. The title, question, input, threshold, count and enabled state are editable rule data. A before-event option can also name a Skill to load through the DSH Skill service. A separate “Skill body about to be injected” event judges each Jev-selected full body before insertion. User-explicit Skill invocation keeps the host behavior.

## 0.1.13

Rule title, rule description, and question title are saved separately. Collapsed cards show the rule title and description. Editing opens one rule at a time, option action text expands on demand, and save controls stay above the list. Existing rules without titles show their rule number until edited.

## 0.1.11

The browser migrates legacy rules before rendering the rule editor, avoiding a transient first-load crash.

## 0.1.10

- Each rule has a switch and an editable description shown in its collapsed summary. The compact editor has four parts: event, content to judge, question, and options with per-option actions; detailed help expands on demand.
- Events are user submission and tool-result return. Input can be the latest user text, text visible at the current step, actual tool results, or fixed custom text.
- A question can be configured directly or generated by trusted local JavaScript. The script may read files and return a title and option labels while stable option IDs retain their configured actions.
- Jev has one master switch. The test page is a separate view opened from rule settings; it neither executes rules nor modifies a session.
- Existing saved rules migrate to option actions on read. Legacy phase switches remain readable but no longer control runtime.

## Rule behavior

The user-message event runs at `agent/pre-step` and can append configured context or request a named Skill. The Skill-injection event runs before each Jev-selected Skill body enters the session; a selected skip action blocks that candidate. If enabled Skill-event rules cannot be judged, that injection is omitted. The tool-result event runs when `llm/stream` sees tool results and can append a reminder before the final finish chunk. The judge receives the title and all 2–16 option labels. Only the highest-probability option can act, and only above the configured threshold. Invalid results, missing input, script failure, or a context-budget overrun execute no action. Generic-model probabilities are estimates, not calibrated confidence.

Skill trimming filters summary catalog entries, not full Skill bodies. If ranking fails, the host catalog remains and a warning is logged. A full catalog already recorded in an older session remains in that history; a new session is filtered on its first injection.

## Question script

The script body receives `event` (`before`, `skill-catalog`, `skill-injection`, `after`, `tool-before`, or `tool-after`), `input`, and `options` (`[{ id, label }]`). It can use `await import(...)` and local Node APIs. Within five seconds it must return:

```js
const fs = await import('node:fs/promises')
const extra = await fs.readFile('C:/rules/question.txt', 'utf8')
return {
  title: extra.trim() + ': Does this request need investigation?',
  options: options.map(option => ({ id: option.id, label: option.label })),
}
```

The worker thread has local Node permissions, so configure only trusted code. Script output can change the title and labels, never option actions.

## Development and release

```powershell
npm run check
npm pack --dry-run
```

Publish source and tag, verify the remote SHA, update the pinned SHA and version in private `plugins.json`, Import, restart DSH, and verify the installed package and browser interactions. Do not install via `link:`, `file:`, or `workspace:`.

## Limitations

Generic probabilities are uncalibrated. Native Jev calls are not yet included in Chat Enhancement’s individual LLM-call statistics. A streamed reminder cannot retract text already displayed. The plugin does not verify factual claims.

MIT

## Plugin display metadata

The plugin list shows **Smart selector** in English and **智能选择器** in Chinese, following the DSH interface language. `locale/en.json` and `locale/zh.json` provide the title and description; `icon.svg` supplies self-contained artwork. The package exports and publishes these resources. The icon is adapted from Lucide; see [ICON_LICENSE.txt](ICON_LICENSE.txt).

## Plugin configuration

Open this plugin from the Plugins list to access its existing configuration and controls. Settings no longer duplicates its navigation entry.

The icon uses a centered 36 × 36 viewBox to leave more space around the artwork inside the plugin icon frame.

With Performance statistics enabled, the optional `agentPreStepTiming` service measures this plugin's own input processing, candidate reads, question-generation scripts and skill snapshots. Downstream pre-step work is excluded. Records contain names and timings, never inputs or script contents.

Native Jev probability requests bypass `llm/stream`. Performance statistics 0.1.3 or later uses the optional `chatStageTiming.request` API to record each native request’s model, purpose, rules and duration. Non-streaming replies do not produce a first-token timestamp.

Candidate selection writes validated scores, ranks, chosen candidates and rule parameters to an ignorable catalog-selection session event, correlated with timings by selectionId. It excludes conversation, question text and skill bodies; diagnostic failure does not change the selection.
