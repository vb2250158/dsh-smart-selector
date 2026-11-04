import { defineTool } from '@deepseek-ai/dsh-tools';
import { installContextPolicy } from './context-policy.mjs';
import { createUserMessage, createDeveloperMessage } from '@deepseek-ai/dsh-llm';
import { joinContextSections } from '@deepseek-ai/dsh-system-prompt';
import { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill';
import { Config, DEFAULT_SETTINGS, SETTINGS_NAMESPACE, SettingsSchema } from './settings.mjs';
import { judge } from './judge.mjs';
import { validateRules } from './policy.mjs';
import { generateQuestion } from './question-script.mjs';
import { beforeInput, toolFacts, afterInput, skillInput } from './rule-input.mjs';
import { createAfterStream } from './after-stream.mjs';
import { testChoice } from './choice-test.mjs';
import { createTestHandler } from './test-route.mjs';
import { resolveSkillRequests } from './skill-injection.mjs';
import { catalogInput, rankCatalog, pruneCatalogMessage } from './catalog-prune.mjs';
import { recordCatalogSelection } from './catalog-selection-record.mjs';
import { resolveCandidates } from './candidate-source.mjs';
import { applyEventSelection, selectEventCandidates } from './event-selection.mjs';
import { toolRuleInput, matchesTool, composeGroupMessage } from './tool-automation.mjs';
import { createCapabilityRegistry, actionParameter } from './capability-registry.mjs';
import { dispatchToTool, dispatchToRabi } from './dispatch-adapters.mjs';
import { createTimedModelStream } from './timed-model.mjs';
import { PLUGIN_NAME, CONFIG_ENTRY_ID } from './identity.mjs';
export { Config, DEFAULT_SETTINGS, SETTINGS_NAMESPACE, SettingsSchema } from './settings.mjs';
export { evaluatePolicy } from './policy.mjs';
export const name = PLUGIN_NAME;
export const inject = ['settings', 'llm', 'skills', 'tools', 'tokenMeter', 'credentials'];
const contextMessage = (text, source = { kind: `plugin:${name}`, form: 'instructions' }) => createUserMessage({ content: [{ type: 'text', text }], source });
const selectedText = (rule, selected) => {
  const items = selected.map(entry => `- ${entry.description}`).join('\n');
  return rule.selectionAction === 'inject-extra' ? rule.selectionActionText.replaceAll('{selected}', items)
    : `[${rule.title || rule.id}]\n${items}`;
};

export function apply(ctx, config = {}) {
  const timedStream = createTimedModelStream(ctx);
  const scope = { get: () => config.get() };
  installContextPolicy(ctx, () => scope.get(), { createUserMessage, createDeveloperMessage, defineTool, joinContextSections });
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
  const capabilities = createCapabilityRegistry();
  const internalCalls = new Set();
  const pendingQuestions = new Set();
  const uncertainDeliveries = new Set();
  const lifecycleController = new AbortController();
  ctx.effect(() => () => lifecycleController.abort());
  const runRules = async (settings, phase, inputFor, signal) => {
    const rules = [], inputs = {};
    for (const rule of validateRules(settings.rules).filter(row => row.enabled && row.phase === phase && row.candidateSource === 'none')) {
      const input = await inputFor(rule);
      if (!input) continue;
      try {
        const prepare = () => generateQuestion(rule, input, signal);
        rules.push(await (ctx.get('chatStageTiming')?.run?.({ plugin: name, operation: 'question-provider' }, prepare) ?? prepare()));
        inputs[rule.id] = input;
      } catch (error) {
        ctx.logger.warn(`Smart Selector question script failed for ${rule.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    if (!rules.length) return { context: '' };
    return judge({ settings, phase, inputs, preparedRules: rules, signal,
      stream: timedStream, createMessage: contextMessage });
  };
  ctx.effect(() => capabilities.registerAdapter({ key: 'tool', display: '调用已安装工具', parameters: [
    { key: 'toolName', display: '工具名称', required: true }, { key: 'messageArgument', display: '消息参数名', defaultValue: 'text' },
    { key: 'idempotencyArgument', display: '幂等 ID 参数名' },
  ] }, dispatchToTool));
  ctx.effect(() => capabilities.registerAdapter({ key: 'rabi', display: 'Rabi 消息渠道', parameters: [
    { key: 'routeId', display: 'Route ID', required: true }, { key: 'channel', display: '渠道', required: true }, { key: 'target', display: '对象类型', required: true },
    { key: 'targetId', display: '对象 ID', required: true }, { key: 'roleId', display: '人格 ID' }, { key: 'waitForReply', display: '等待回复', kind: 'boolean', defaultValue: 'false' },
    { key: 'pollMinutes', display: '检查间隔（分钟）', kind: 'number', defaultValue: '10' }, { key: 'maxPolls', display: '最多检查次数', kind: 'number', defaultValue: '432' },
  ] }, dispatchToRabi));
  const dispatch = async ({ action, agent, eventText, signal, eventId, ruleId, onDone }) => {
    const adapterKey = actionParameter(action, 'adapter');
    const adapter = capabilities.adapter(adapterKey);
    if (!adapter) throw new Error(`Smart Selector action adapter ${adapterKey || '(empty)'} is unavailable`);
    const message = await composeGroupMessage({ ctx, settings: scope.get(), instruction: action.text, eventText, signal, createMessage: contextMessage });
    return adapter({ ctx, agent, action, message, signal, internalCalls, eventId, ruleId, settings: scope.get(), logger: ctx.logger,
      pollSignal: lifecycleController.signal, createMessage: contextMessage, onDone });
  };
  const service = {
    registerEvent: (definition) => capabilities.registerEvent(definition),
    registerAdapter: (definition, handler) => capabilities.registerAdapter(definition, handler),
    events: () => capabilities.events(), adapters: () => capabilities.adapters(),
    emit: async ({ key, id, agent, parameters = {}, signal = new AbortController().signal }) => {
      if (!capabilities.event(key)) throw new Error(`Smart Selector event ${key} has no registered source`);
      if (typeof id !== 'string' || !id.trim() || !agent?.session?.id) throw new TypeError('Smart Selector external event needs a stable ID and agent session');
      const settings = scope.get();
      if (!settings.enabled) return { decisions: [], context: '', parameters: { ...parameters }, selections: [] };
      const rules = validateRules(settings.rules).filter(rule => rule.enabled && rule.phase === 'external' && rule.eventKey === key);
      let updatedParameters = { ...parameters };
      const textFor = rule => rule.input === 'custom-text' ? rule.customInput
        : rule.input === 'event-param' ? (typeof updatedParameters[rule.inputParameterKey] === 'string' ? updatedParameters[rule.inputParameterKey] : JSON.stringify(updatedParameters[rule.inputParameterKey] ?? ''))
          : catalogInput(rule, agent, [], settings.maxContextCharacters);
      const manualRules = rules.filter(rule => rule.candidateSource === 'none');
      const result = await runRules({ ...settings, rules: manualRules }, 'external', textFor, signal);
      for (const hit of result.decisions?.filter(row => row.status === 'applied' && row.action?.type === 'dispatch') ?? []) {
        const rule = rules.find(row => row.id === hit.ruleId);
        await dispatch({ action: hit.action, agent, eventText: textFor(rule), signal, eventId: id, ruleId: rule.id });
      }
      if (result.context) agent.followup(contextMessage(result.context));
      const selections = [];
      for (const rule of rules.filter(row => row.candidateSource === 'event-params')) {
        const input = textFor(rule);
        if (!input) continue;
        const selected = await selectEventCandidates({ settings, rule, parameters: updatedParameters, input, signal,
          stream: timedStream, createMessage: contextMessage });
        const applied = applyEventSelection(updatedParameters, rule, selected);
        updatedParameters = applied.parameters;
        selections.push(applied.selection);
        if (rule.selectionAction === 'inject-extra' && selected.length) agent.followup(contextMessage(selectedText(rule, selected.map(entry => ({ description: entry.text })))));
      }
      return { ...result, parameters: updatedParameters, selections };
    },
  };
  ctx.effect(() => ctx.provide('smartSelector', service));
  // Existing event providers retain the same service and disposer semantics during migration.
  ctx.effect(() => ctx.provide('jev', service));
  ctx.on('tools/pre-execute', async (exec, next) => {
    const settings = scope.get();
    if (!settings.enabled || internalCalls.has(exec.callId) || !exec.agent || exec.signal.aborted) return next();
    const rules = validateRules(settings.rules).filter(rule => rule.enabled && rule.phase === 'tool-before' && matchesTool(rule, exec.name));
    if (!rules.length) return next();
    try {
      const result = await runRules({ ...settings, rules }, 'tool-before', rule => toolRuleInput(rule, exec, undefined, settings.maxContextCharacters), exec.signal);
      const block = result.decisions?.find(decision => decision.status === 'applied' && decision.action?.type === 'deny-tool');
      if (block) return { kind: 'deny', reason: block.action.text };
    } catch (error) {
      exec.signal.throwIfAborted();
      ctx.logger.warn(`Smart Selector tool-before judgement unavailable for ${exec.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return next();
  }, { global: true });
  ctx.on('tools/post-execute', async (exec, toolResult, next) => {
    const decision = await next();
    const settings = scope.get();
    if (!settings.enabled || internalCalls.has(exec.callId) || !exec.agent || exec.signal.aborted || decision.kind === 'block') return decision;
    const rules = validateRules(settings.rules).filter(rule => rule.enabled && rule.phase === 'tool-after' && matchesTool(rule, exec.name));
    if (!rules.length) return decision;
    try {
      const outcome = await runRules({ ...settings, rules }, 'tool-after', rule => toolRuleInput(rule, exec, toolResult, settings.maxContextCharacters), exec.signal);
      const contexts = outcome.context ? [contextMessage(outcome.context)] : [];
      for (const hit of outcome.decisions?.filter(row => row.status === 'applied' && row.action?.type === 'dispatch') ?? []) {
        const rule = rules.find(row => row.id === hit.ruleId);
        if (!rule) continue;
        const key = `${exec.agent.session.id}:${rule.id}`;
        const waiting = actionParameter(hit.action, 'waitForReply') === 'true';
        if (uncertainDeliveries.has(key) || waiting && pendingQuestions.has(key)) continue;
        if (waiting) pendingQuestions.add(key);
        try {
          await dispatch({ action: hit.action, agent: exec.agent, eventText: toolRuleInput(rule, exec, toolResult, settings.maxContextCharacters), signal: exec.signal,
            eventId: exec.callId, ruleId: rule.id, onDone: () => pendingQuestions.delete(key) });
          if (!waiting) pendingQuestions.delete(key);
        } catch (error) {
          if (error?.code === 'UNCERTAIN_DELIVERY') uncertainDeliveries.add(key);
          else pendingQuestions.delete(key);
          throw error;
        }
      }
      if (contexts.length) return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), ...contexts] };
    } catch (error) {
      exec.signal.throwIfAborted();
      ctx.logger.warn(`Smart Selector tool-after action failed for ${exec.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return decision;
  }, { global: true });
  ctx.inject(['webServer'], web => {
    const routes = [{ suffix: 'test',
      handler: createTestHandler((input, signal) => testChoice({
        settings: scope.get(), ...input, signal,
        stream: timedStream, createMessage: contextMessage,
      })),
    }, { suffix: 'tools',
      handler: (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ tools: ctx.tools.schemas().map(tool => tool.name).sort() }));
      },
    }, { suffix: 'capabilities',
      handler: (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        const toolNames = new Set(ctx.tools.schemas().map(tool => tool.name));
        response.end(JSON.stringify({ events: capabilities.events(), adapters: capabilities.adapters().map(adapter => ({ ...adapter,
          available: adapter.key !== 'rabi' || toolNames.has('rabiroute_agent_send') && toolNames.has('rabiroute_manager_api') })) }));
      },
    }];
    for (const prefix of [PLUGIN_NAME, CONFIG_ENTRY_ID]) for (const route of routes) {
      web.effect(() => web.webServer.register({ kind: 'exact', path: `/api/${prefix}/${route.suffix}`, handler: route.handler }));
    }
  });
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    let decision = await next();
    const onSelection = selection => recordCatalogSelection(agent.session, { turn, step }, selection,
      () => ctx.logger.warn('Smart Selector candidate selection details could not be recorded'));
    const timed = (operation, task) => ctx.get('agentPreStepTiming')?.run({ agent, turn, step },
      { plugin: 'dsh-smart-selector', operation }, task) ?? task();
    return timed('input-rules', async () => {
      const settings = scope.get();
      if (decision.kind !== 'enter' || !settings.enabled || signal.aborted) return decision;
      const catalogRules = validateRules(settings.rules).filter(rule => rule.enabled && rule.phase === 'skill-catalog');
      for (const rule of catalogRules) {
        const catalogIndex = decision.messages.findIndex(message => message.source?.kind === 'skill-catalog');
        if (catalogIndex < 0) break;
        const catalog = decision.messages[catalogIndex];
        if (!catalog.source.entries.length) continue;
        const input = catalogInput(rule, agent, decision.messages, settings.maxContextCharacters);
        if (!input) continue;
        try {
          const eventParameters = { skills: catalog.source.entries };
          const candidates = eventParameters[rule.candidateParameterKey];
          if (!Array.isArray(candidates)) throw new Error(`Smart Selector event parameter ${rule.candidateParameterKey} is unavailable`);
          const prepared = await timed('question-provider', () => generateQuestion(rule, input, signal, candidates));
          const entries = await rankCatalog({ settings, rule: prepared, entries: candidates, input, signal,
            stream: timedStream, createMessage: contextMessage, onSelection });
          const messages = [...decision.messages];
          if (rule.selectionAction === 'prune') messages[catalogIndex] = pruneCatalogMessage(catalog, entries, escapeText);
          else if (entries.length) {
            const text = selectedText(rule, entries);
            if (text.length > settings.maxContextCharacters) throw new Error('Selected candidate content exceeds context budget');
            messages.splice(catalogIndex + 1, 0, contextMessage(text));
          }
          decision = { ...decision, messages };
        } catch (error) {
          signal.throwIfAborted();
          ctx.logger.warn(`Smart Selector Skill catalog rule ${rule.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      const selectionRules = validateRules(settings.rules).filter(rule => rule.enabled && rule.phase === 'before' && rule.candidateSource !== 'none');
      for (const rule of selectionRules) {
        const input = catalogInput(rule, agent, decision.messages, settings.maxContextCharacters);
        if (!input) continue;
        try {
          const candidates = await timed('candidate-source', () => resolveCandidates(rule, input, signal));
          const prepared = await timed('question-provider', () => generateQuestion(rule, input, signal, candidates));
          const selected = await rankCatalog({ settings, rule: prepared, entries: candidates, input, signal,
            stream: timedStream, createMessage: contextMessage, onSelection });
          if (!selected.length) continue;
          const text = selectedText(rule, selected);
          if (text.length > settings.maxContextCharacters) throw new Error('Selected candidate content exceeds context budget');
          const messages = [...decision.messages];
          const explicitSkillIndex = messages.findIndex(message => message.source?.kind === 'skill-invocation');
          messages.splice(explicitSkillIndex < 0 ? messages.length : explicitSkillIndex, 0, contextMessage(text));
          decision = { ...decision, messages };
        } catch (error) {
          signal.throwIfAborted();
          ctx.logger.warn(`Smart Selector candidate rule ${rule.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      if (!settings.rules.some(rule => rule.enabled && rule.phase === 'before' && (rule.candidateSource ?? 'none') === 'none')) return decision;
      try {
        const needsSkillSummaries = settings.rules.some(rule => rule.enabled && rule.phase === 'before' && rule.input === 'user-message-with-skills');
        let snapshot = { skills: [], complete: true };
        if (needsSkillSummaries) {
          try { snapshot = await timed('skill-snapshot', () => ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })); }
          catch (error) {
            signal.throwIfAborted();
            ctx.logger.warn(`Smart Selector skill catalog unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
            snapshot = { skills: [], complete: false };
          }
        }
        const result = await timed('before', () => runRules(settings, 'before', rule => beforeInput(rule, decision.messages, snapshot.complete ? snapshot.skills : []), signal));
        signal.throwIfAborted();
        const selected = await resolveSkillRequests({
          requests: result.skillRequests ?? [], existingMessages: decision.messages, skills: ctx.skills, agent, signal,
          maxCharacters: settings.maxContextCharacters, usedCharacters: result.context.length,
          render: renderSkillContent, createMessage: contextMessage,
          beforeInject: settings.rules.some(rule => rule.enabled && rule.phase === 'skill-injection')
            ? async skill => {
              const skillResult = await runRules(settings, 'skill-injection', rule => skillInput(rule, skill, decision.messages), signal);
              if (!skillResult.decisions?.length) throw new Error('Skill injection rules produced no judgement');
              return { skip: skillResult.skipSkill, context: skillResult.context };
            }
            : undefined,
        });
        for (const outcome of selected.outcomes.filter(row => ['skill-unavailable', 'budget-exceeded', 'skill-judgement-unavailable'].includes(row.status)))
          ctx.logger.warn(`Smart Selector skill injection ${outcome.status} for rule ${outcome.ruleId}.`);
        const additions = [...(result.context ? [contextMessage(result.context)] : []), ...selected.messages];
        if (!additions.length) return decision;
        const messages = [...decision.messages];
        const explicitSkillIndex = messages.findIndex(message => message.source?.kind === 'skill-invocation');
        messages.splice(explicitSkillIndex < 0 ? messages.length : explicitSkillIndex, 0, ...additions);
        return { ...decision, messages };
      } catch {
        signal.throwIfAborted();
        ctx.logger.warn('Smart Selector user-message judgement unavailable; no context injected. Check model configuration and test page.');
        return decision;
      }
    });
  }, { global: true, prepend: true });
  ctx.on('llm/stream', (options, next) => {
    const settings = scope.get();
    const afterRules = settings.rules.filter(rule => rule.enabled && rule.phase === 'after');
    if (!settings.enabled || !afterRules.length || options.purpose !== undefined) return next();
    const facts = toolFacts(options.messages);
    if (!facts.length) return next();
    const signal = options.signal
      ? AbortSignal.any([options.signal, lifecycleController.signal])
      : lifecycleController.signal;
    return createAfterStream({
      createUpstream: next,
      judge: async ownedSignal => {
        const result = await runRules(settings, 'after', rule => afterInput(rule, facts), ownedSignal);
        return result.context;
      },
      signal,
      onJudgementError: error => ctx.logger.warn(`Smart Selector tool-result judgement unavailable; original stream preserved: ${error instanceof Error ? error.message : String(error)}`),
    });
  });
}
