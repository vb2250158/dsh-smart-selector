import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONTEXT_POLICY } from './context-defaults.mjs';
import { isNativeSelection } from './mode.mjs';

export const SETTINGS_NAMESPACE = 'jev-context-gate';
const commonRuleFields = { toolName: '',
  candidateText: '', candidateScript: '', candidateParameterKey: '', candidateParameterDisplay: '', splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '' };
export const defaultRules = Object.freeze([
  { ...commonRuleFields, id: 'skill-trimming', enabled: true, title: 'Skill 裁剪', description: '按当前上下文的相关度，只向主模型提供最相关的 Skill 简介。', phase: 'skill-catalog', input: 'current-context-text', customInput: '', candidateSource: 'event-params', candidateText: '', candidateScript: '', candidateParameterKey: 'skills',
    questionSource: 'configured', questionScript: '', question: '与当前上下文最相关的 Skill 有哪些？', threshold: 0,
    splitMode: 'newline', splitText: '', selectionMode: 'score-above', selectionValue: '50', selectionAction: 'prune', selectionActionText: '', options: [] },
]);
export const groupRulePresets = Object.freeze(defaultRules.filter(rule => ['rabi-progress', 'rabi-unresolved-question'].includes(rule.id)));
export const DEFAULT_DECISION_API = { enabled: false, model: 'typesafe/jev-1.13', timeoutMs: 30000 };
export const DEFAULT_SETTINGS = { decisionApi: { ...DEFAULT_DECISION_API }, enabled: false, provider: '', model: '', nativeJev: true, beforeEnabled: true, afterEnabled: true, maxContextCharacters: 12000, maxCorrections: 2, presetVersion: 0, rules: structuredClone(defaultRules) };
const actionParameterSchema = z.object({ key: z.string().required(), display: z.string().default(''), value: z.string().default('') });
const actionSchema = z.object({ type: z.union([z.const('none'), z.const('inject-context'), z.const('inject-skill'), z.const('append-reminder'), z.const('skip-skill'), z.const('keep-top-skills'), z.const('inject-selected-candidates'), z.const('deny-tool'), z.const('notify-group'), z.const('ask-group'), z.const('dispatch')]).required(), text: z.string().default(''), params: z.array(actionParameterSchema).default([]) });
const optionSchema = z.object({ id: z.string().required(), label: z.string().required(), action: actionSchema.required() });
const ruleSchema = z.object({
  questionType: z.union([z.const(''), z.const('choice'), z.const('noul'), z.const('score')]).default(''),
  scoreLevels: z.array(z.string()).default(['不相关', '部分相关', '高度相关']),
  id: z.string().required(), enabled: z.boolean().default(true), title: z.string().default(''), description: z.string().default(''), phase: z.union([z.const('before'), z.const('after'), z.const('skill-injection'), z.const('skill-catalog'), z.const('tool-before'), z.const('tool-after'), z.const('external')]).required(), eventKey: z.string().default(''), eventDisplay: z.string().default(''), inputParameterKey: z.string().default(''), inputParameterDisplay: z.string().default(''),
  toolName: z.string().default(''), groupRouteId: z.string().default(''), groupId: z.string().default(''), groupRoleId: z.string().default(''), pollMinutes: z.number().step(1).min(1).max(1440).default(10), maxPolls: z.number().step(1).min(1).max(1008).default(432),
  input: z.string().default(''), customInput: z.string().default(''), questionSource: z.string().default('configured'),
  candidateSource: z.string().default('none'), candidateText: z.string().default(''), candidateScript: z.string().default(''),
  candidateParameterKey: z.string().default(''), candidateParameterDisplay: z.string().default(''),
  splitMode: z.string().default('newline'), splitText: z.string().default(''),
  selectionMode: z.string().default(''), selectionValue: z.string().default(''), selectionAction: z.string().default(''), selectionActionText: z.string().default(''),
  questionScript: z.string().default(''), question: z.string().default(''), options: z.array(optionSchema).default([]),
  threshold: z.number().min(0).max(1).default(0.8), context: z.string().default(''),
});
const fields = {
  messageModel: z.object({ provider: z.string().default(''), model: z.string().default('') }).default({ provider: '', model: '' }),
  decisionApi: z.object({
    enabled: z.boolean().default(DEFAULT_DECISION_API.enabled),
    model: z.string().default(DEFAULT_DECISION_API.model),
    timeoutMs: z.number().step(1).min(1000).max(120000).default(DEFAULT_DECISION_API.timeoutMs),
  }).default({ ...DEFAULT_DECISION_API }),
  contextPolicy: z.object({
    enabled: z.boolean().default(true),
    headroomRatio: z.number().min(0).max(0.25).default(DEFAULT_CONTEXT_POLICY.headroomRatio),
    thresholdRatio: z.number().min(0.1).max(0.95).default(DEFAULT_CONTEXT_POLICY.thresholdRatio),
    targetRatio: z.number().min(0.1).max(0.8).default(DEFAULT_CONTEXT_POLICY.targetRatio),
    retainRatio: z.number().min(0).max(0.5).default(DEFAULT_CONTEXT_POLICY.retainRatio),
    maxSnapshotCharacters: z.number().step(1).min(1024).max(64000).default(DEFAULT_CONTEXT_POLICY.maxSnapshotCharacters),
    catalogDescriptionCharacters: z.number().step(1).min(16).max(500).default(DEFAULT_CONTEXT_POLICY.catalogDescriptionCharacters),
    previewItems: z.number().step(1).min(0).max(20).default(DEFAULT_CONTEXT_POLICY.previewItems),
    detailPageCharacters: z.number().step(1).min(256).max(16000).default(DEFAULT_CONTEXT_POLICY.detailPageCharacters),
  }).default({ ...DEFAULT_CONTEXT_POLICY }),
  enabled: z.boolean().default(false), provider: z.string().default(''), model: z.string().default(''),
  nativeJev: z.boolean().default(true), beforeEnabled: z.boolean().default(true), afterEnabled: z.boolean().default(true),
  maxContextCharacters: z.number().step(1).min(0).max(64000).default(12000),
  maxCorrections: z.number().step(1).min(0).max(8).default(2),
  presetVersion: z.number().step(1).min(0).max(1).default(0),
  rules: z.array(ruleSchema).default(structuredClone(defaultRules)),
};
const normalize = value => {
  const { apiKeyRef: _retiredCredential, ...decisionApi } = value.decisionApi;
  value = { ...value, decisionApi };
  if (!/^typesafe\/jev-[A-Za-z0-9.-]+$/.test(value.decisionApi.model)) throw new TypeError('Invalid OpenRouter Jev configuration');
  if (value.contextPolicy.retainRatio >= value.contextPolicy.targetRatio) throw new TypeError('上下文保留比例必须小于压缩目标比例。');
  if (!Array.isArray(value.rules) || value.rules.length > 64) throw new TypeError('Expected at most 64 rules');
  const migrateAction = (action, rule) => {
    if (action.type !== 'notify-group' && action.type !== 'ask-group') return { ...action, params: action.params ?? [] };
    const values = { adapter: 'rabi', routeId: rule.groupRouteId ?? '', channel: 'napcat', target: 'group', targetId: rule.groupId ?? '',
      roleId: rule.groupRoleId ?? '', waitForReply: String(action.type === 'ask-group'), pollMinutes: String(rule.pollMinutes ?? 10),
      maxPolls: String(rule.maxPolls ?? 432), replyThreshold: String(rule.threshold ?? 0.8) };
    return { type: 'dispatch', text: action.text, params: Object.entries(values).map(([key, entry]) => ({ key, display: '', value: entry })) };
  };
  const ids = new Set();
  const rules = value.rules.map(rule => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id)) throw new TypeError('Invalid or duplicate rule id');
    ids.add(rule.id);
    const input = rule.input || (rule.phase === 'after' ? 'tool-results' : rule.phase === 'skill-injection' ? 'skill-summary' : 'latest-user-message');
    const candidateSource = rule.phase === 'skill-catalog' ? 'event-params' : rule.candidateSource === 'input-lines' ? 'input-split' : rule.candidateSource;
    const legacy = candidateSource === 'none' && rule.options.length === 0;
    const question = legacy && rule.phase === 'after' ? '本轮工具结果是否包含失败？' : rule.question;
    const options = legacy ? (rule.phase === 'before'
      ? [{ id: 'yes', label: '是', action: { type: 'inject-context', text: rule.context } }, { id: 'no', label: '否', action: { type: 'none', text: '' } }]
      : [{ id: 'failed', label: '有失败', action: { type: 'append-reminder', text: rule.context } }, { id: 'success', label: '全部成功', action: { type: 'none', text: '' } }]) : rule.options.map(option => ({ ...option, action: migrateAction(option.action, rule) }));
    const questionType = rule.questionType || (candidateSource === 'none' ? 'choice' : 'noul');
    const scoreLevels = rule.scoreLevels;
    if (scoreLevels.length > 16 || scoreLevels.some(level => level.length > 800)
      || candidateSource !== 'none' && questionType === 'score' && (scoreLevels.length < 2 || scoreLevels.some(level => !level.trim()) || new Set(scoreLevels).size !== scoreLevels.length)
      || candidateSource === 'none' && questionType === 'noul' && options.length !== 2) throw new TypeError('Invalid question type or score levels');
    const candidateParameterKey = rule.candidateParameterKey || (rule.phase === 'skill-catalog' ? 'skills' : '');
    const splitMode = rule.splitMode || 'newline';
    const splitText = rule.splitText;
    const selectionMode = rule.selectionMode || 'top';
    const selectionValue = rule.selectionValue || (candidateSource === 'none' ? '10' : options[0]?.action?.text) || '10';
    const selectionAction = rule.selectionAction || 'prune';
    const selectionActionText = rule.selectionActionText;
    if (!['before', 'after', 'skill-injection', 'skill-catalog', 'tool-before', 'tool-after', 'external'].includes(rule.phase) || (rule.phase.startsWith('tool-')
      ? !['tool-call', 'tool-result', 'current-context-text', 'custom-text'].includes(input)
      : rule.phase === 'before'
      ? !['latest-user-message', 'current-context-text', 'user-message-with-skills', 'custom-text'].includes(input)
      : rule.phase === 'after' ? !['tool-results', 'custom-text'].includes(input)
        : rule.phase === 'external' ? !['event-param', 'custom-text', 'current-context-text'].includes(input)
        : rule.phase === 'skill-injection' ? !['skill-summary', 'skill-content', 'latest-user-message', 'current-context-text', 'custom-text'].includes(input)
          : !['current-context-text', 'latest-user-message', 'custom-text'].includes(input))
      || (rule.phase === 'external' && (!/^[a-z][a-z0-9.-]{0,119}$/.test(rule.eventKey) || rule.eventDisplay.length > 120 || rule.inputParameterDisplay.length > 120 || (input === 'event-param' && !/^[a-z][a-z0-9.-]{0,119}$/.test(rule.inputParameterKey))))
      || rule.title.length > 120 || rule.description.length > 500 || rule.customInput.length > 24000 || rule.questionScript.length > 16000 || question.length > 8000
      || rule.toolName.length > 120 || (rule.phase.startsWith('tool-') && !rule.toolName.trim())
      || rule.groupRouteId.length > 120 || rule.groupId.length > 120 || rule.groupRoleId.length > 120
      || !['configured', 'script'].includes(rule.questionSource)
      || (rule.questionSource === 'configured' && !question.trim())
      || (rule.questionSource === 'script' && !rule.questionScript.trim())
      || (input === 'custom-text' && !rule.customInput.trim())
      || !(rule.phase === 'skill-catalog' ? candidateSource === 'event-params' && candidateParameterKey === 'skills' : rule.phase === 'before' ? ['none', 'custom-list', 'input-split', 'script'].includes(candidateSource) : rule.phase === 'external' ? ['none', 'event-params'].includes(candidateSource) : candidateSource === 'none')
      || rule.candidateText.length > 64000 || rule.candidateScript.length > 16000 || rule.candidateParameterDisplay.length > 120
      || (candidateSource === 'event-params' && !/^[a-z][a-z0-9.-]{0,119}$/.test(candidateParameterKey))
      || (candidateSource === 'custom-list' && rule.candidateText.split(/\r?\n/).filter(item => item.trim()).length < 2)
      || (candidateSource === 'script' && !rule.candidateScript.trim())
      || !['newline', 'space', 'literal'].includes(splitMode) || splitText.length > 100
      || (candidateSource === 'input-split' && splitMode === 'literal' && !splitText)
      || !['top', 'bottom', 'score-above', 'score-below'].includes(selectionMode)
      || !(selectionMode === 'top' || selectionMode === 'bottom' ? /^[1-9][0-9]*$/.test(selectionValue) && Number.isSafeInteger(Number(selectionValue))
        : /^(?:100(?:\.0+)?|(?:[0-9]|[1-9][0-9])(?:\.[0-9]+)?)$/.test(selectionValue))
      || !['prune', 'inject-extra'].includes(selectionAction) || selectionActionText.length > 8000
      || (candidateSource !== 'none' && selectionAction === 'inject-extra' && !selectionActionText.trim())
      || (candidateSource === 'none' && (options.length < 2 || options.length > 16))) throw new TypeError('Invalid rule');
    if (candidateSource !== 'none' && options.length > 0 && (options.length !== 2
      || options[0].action?.type !== (candidateSource === 'event-params' ? 'keep-top-skills' : 'inject-selected-candidates')
      || options[1].action?.type !== 'none')) throw new TypeError('Invalid legacy selection options');
    const optionIds = new Set(), labels = new Set();
    for (const option of candidateSource === 'none' ? options : []) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(option.id) || optionIds.has(option.id)
        || !option.label.trim() || option.label.length > 800 || labels.has(option.label.trim())
        || !(rule.phase === 'before' ? candidateSource === 'none' ? ['none', 'inject-context', 'inject-skill'] : ['none', 'inject-selected-candidates'] : rule.phase === 'after' ? ['none', 'append-reminder'] : rule.phase === 'tool-before' ? ['none', 'deny-tool'] : rule.phase === 'tool-after' ? ['none', 'inject-context', 'dispatch'] : rule.phase === 'external' ? ['none', 'inject-context', 'dispatch'] : rule.phase === 'skill-injection' ? ['none', 'skip-skill', 'inject-context'] : ['none', 'keep-top-skills']).includes(option.action.type)
        || (option.action.params ?? []).some(parameter => !/^[A-Za-z][A-Za-z0-9._-]{0,119}$/.test(parameter.key) || parameter.display.length > 120 || parameter.value.length > 8000)
        || new Set((option.action.params ?? []).map(parameter => parameter.key)).size !== (option.action.params ?? []).length
        || (option.action.type === 'dispatch' && !(option.action.params ?? []).some(parameter => parameter.key === 'adapter' && parameter.value.trim()))
        || option.action.text.length > 8000 || (!['none', 'skip-skill'].includes(option.action.type) && !option.action.text.trim())
        || (option.action.type === 'inject-skill' && (option.action.text.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(option.action.text)))) throw new TypeError('Invalid option');
      optionIds.add(option.id); labels.add(option.label.trim());
    }
    if (input === 'user-message-with-skills' && !options.some(option => option.action.type === 'inject-skill')) throw new TypeError('Skill-aware input requires a skill action');
    return { id: rule.id, enabled: rule.enabled, title: rule.title, description: rule.description, phase: rule.phase, eventKey: rule.eventKey, eventDisplay: rule.eventDisplay, inputParameterKey: rule.inputParameterKey, inputParameterDisplay: rule.inputParameterDisplay, toolName: rule.toolName, input, customInput: rule.customInput,
      candidateSource, candidateText: rule.candidateText, candidateScript: rule.candidateScript, candidateParameterKey, candidateParameterDisplay: rule.candidateParameterDisplay,
      splitMode, splitText, selectionMode, selectionValue, selectionAction, selectionActionText,
      questionType, scoreLevels, questionSource: rule.questionSource, questionScript: rule.questionScript, question, options: candidateSource === 'none' ? options : [], threshold: rule.threshold };
  });
  // Releases 0.1.38–39 stored native selection beside the ordinary model.
  // Decode that document once into the same provider/model pair used by the picker.
  if (value.decisionApi.enabled) return { ...value, rules,
    provider: 'openrouter', model: value.decisionApi.model,
    messageModel: isNativeSelection(value) ? value.messageModel : { provider: value.provider, model: value.model },
    decisionApi: { ...value.decisionApi, enabled: false },
  };
  return { ...value, rules };
};
export const SettingsSchema = z.transform(z.object(fields), normalize, true);
export const Config = SettingsSchema.volatile().default({});
