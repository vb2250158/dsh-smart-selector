/** Explicit user-configured rules for lifecycle and policy tests; independent of shipped defaults. */
const commonRuleFields = { toolName: '',
  candidateText: '', candidateScript: '', candidateParameterKey: '', candidateParameterDisplay: '', splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '' };
const rabiAction = (text, waiting) => ({ type: 'dispatch', text, params: Object.entries({ adapter: 'rabi', routeId: '', channel: 'napcat', target: 'group', targetId: '', roleId: '',
  waitForReply: String(waiting), pollMinutes: '10', maxPolls: '432', replyThreshold: '0.8' }).map(([key, value]) => ({ key, display: '', value })) });
export const defaultRules = Object.freeze([
  { ...commonRuleFields, id: 'investigate-before-claim', enabled: true, title: '先查证据', description: '判断用户请求是否需要先检查证据。', phase: 'before', input: 'latest-user-message', customInput: '', candidateSource: 'none', candidateText: '', candidateScript: '', candidateParameterKey: '',
    splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '',
    questionSource: 'configured', questionScript: '', question: '这项请求是否需要先检查证据，才能判断原因？', threshold: 0.8,
    options: [
      { id: 'yes', label: '是，需要先检查证据', action: { type: 'inject-context', text: '不要仅凭截图或描述猜测根因。先检查相关源码、配置、日志或运行证据；尚未核实的判断要明确标为假设。' } },
      { id: 'no', label: '否，可以直接处理', action: { type: 'none', text: '' } },
    ] },
  { ...commonRuleFields, id: 'evidence-after-answer', enabled: true, title: '工具失败提醒', description: '工具返回失败时提醒核对证据。', phase: 'after', input: 'tool-results', customInput: '', candidateSource: 'none', candidateText: '', candidateScript: '', candidateParameterKey: '',
    splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '',
    questionSource: 'configured', questionScript: '', question: '本轮工具结果是否包含失败？', threshold: 0.8,
    options: [
      { id: 'failed', label: '有失败', action: { type: 'append-reminder', text: '提出原因或完成结论前，对照本轮实际收集的证据。证据不足时，明确说明尚未核实；只要存在已获授权的下一步，就继续调查。' } },
      { id: 'success', label: '全部成功', action: { type: 'none', text: '' } },
    ] },
  { ...commonRuleFields, id: 'skill-trimming', enabled: true, title: 'Skill 裁剪', description: '按当前上下文的相关度，只向主模型提供最相关的 Skill 简介。', phase: 'skill-catalog', input: 'current-context-text', customInput: '', candidateSource: 'event-params', candidateText: '', candidateScript: '', candidateParameterKey: 'skills',
    questionSource: 'configured', questionScript: '', question: '与当前上下文最相关的 Skill 有哪些？', threshold: 0,
    splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '', options: [] },
  { ...commonRuleFields, id: 'rabi-progress', enabled: false, title: '工作群进度更新', description: 'Rabi 工具完成重要进展后向工作群报告正在做什么。', phase: 'tool-after', toolName: 'rabiroute_*', input: 'current-context-text', customInput: '', candidateSource: 'none', questionSource: 'configured', questionScript: '', question: '这次工具结果是否包含值得告知工作群的重要进度更新？', threshold: 0.8,
    options: [{ id: 'important', label: '有重要进度', action: rabiAction('用一两句话说明已确认的进展、当前正在做的事和下一步；不得说已完成未经验证的工作。', false) }, { id: 'ordinary', label: '普通进度', action: { type: 'none', text: '' } }] },
  { ...commonRuleFields, id: 'rabi-unresolved-question', enabled: false, title: '工作群提问并等待', description: '存在必须由用户解答的疑问时在工作群提问，每 10 分钟检查回复。', phase: 'tool-after', toolName: 'rabiroute_*', input: 'current-context-text', customInput: '', candidateSource: 'none', questionSource: 'configured', questionScript: '', question: '当前会话是否有无法通过继续调查解决、必须询问工作群成员的具体问题？', threshold: 0.8,
    options: [{ id: 'ask', label: '需要群里回答', action: rabiAction('只提出当前必须回答的一个具体问题，说明需要对方提供什么信息；不要把内部推断当成事实。', true) }, { id: 'continue', label: '继续自行处理', action: { type: 'none', text: '' } }] },
]);
