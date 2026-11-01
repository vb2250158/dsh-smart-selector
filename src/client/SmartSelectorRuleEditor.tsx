import * as React from 'react'
import { Button, Input, Menu, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { EVENT_DEFINITIONS, optionParametersForEvent } from '../event-parameters.mjs'
import styles from './SmartSelectorSettingsSection.module.css'
import { QuestionTypePicker, type QuestionType } from './QuestionTypePicker.tsx'

export type Action = { type: 'none' | 'inject-context' | 'inject-skill' | 'append-reminder' | 'skip-skill' | 'keep-top-skills' | 'inject-selected-candidates' | 'deny-tool' | 'dispatch'; text: string; params?: { key: string; display: string; value: string }[] }
export type RuleOption = { id: string; label: string; action: Action }
export type Rule = {
  id: string; enabled: boolean; title: string; description: string; phase: 'before' | 'after' | 'skill-injection' | 'skill-catalog' | 'tool-before' | 'tool-after' | 'external'; eventKey: string; eventDisplay: string; inputParameterKey: string; inputParameterDisplay: string; input: string; customInput: string
  toolName: string
  candidateSource: 'none' | 'event-params' | 'custom-list' | 'input-split' | 'script'; candidateText: string; candidateScript: string; candidateParameterKey: string; candidateParameterDisplay: string
  splitMode: 'space' | 'newline' | 'literal'; splitText: string
  selectionMode: 'score-below' | 'score-above' | 'top' | 'bottom'; selectionValue: string
  selectionAction: 'prune' | 'inject-extra'; selectionActionText: string
  questionType?: QuestionType; scoreLevels?: string[]
  questionSource: 'configured' | 'script'; questionScript: string; question: string
  options: RuleOption[]; threshold: number
}
export type DraftRule = Omit<Rule, 'threshold'> & { thresholdPercent: string }

const inputNames: Record<string, string> = {
  'latest-user-message': '最新一条用户消息的文字',
  'current-context-text': '当前步骤可见的全部文本',
  'user-message-with-skills': '最新用户消息和候选 Skill 简介',
  'skill-summary': '当前 Skill 简介与用户消息',
  'skill-content': '当前 Skill 正文',
  'tool-results': '本轮工具结果',
  'tool-call': '本次工具名称与参数',
  'tool-result': '本次工具名称、参数与结果',
  'event-param': '事件参数',
  'custom-text': '自定义文字',
}
const actionNames: Record<Action['type'], string> = {
  none: '不执行动作', 'inject-context': '补充主会话上下文', 'inject-skill': '注入 Skill 正文', 'append-reminder': '在答复末尾追加提醒', 'skip-skill': '跳过此次 Skill 注入', 'keep-top-skills': '保留最相关的 Skill', 'inject-selected-candidates': '注入入选内容', 'deny-tool': '拦截工具调用', dispatch: '调用外部动作',
}

function Choice({ label, value, choices, disabled, onSelect }: {
  label: string; value: string; choices: { id: string; label: string }[]; disabled: boolean; onSelect: (value: string) => void
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const selectedLabel = choices.find(item => item.id === value)?.label ?? '请选择'
  return <div className={styles.choiceField}><span>{label}</span><Menu portal autoFocus open={open && !disabled} onClose={() => setOpen(false)}
    selectedId={value} items={choices} onSelect={id => { onSelect(id); setOpen(false) }}
    anchor={<Button className={styles.choiceButton} variant="outline" size="sm" disabled={disabled} aria-label={`${label}：${selectedLabel}`} aria-haspopup="menu" aria-expanded={open && !disabled} onClick={() => setOpen(true)}><span className={styles.choiceValue}>{selectedLabel}</span><span aria-hidden="true">▾</span></Button>} /></div>
}

/** Edit one rule in a dialog while its card shows the configured title and description. */
export function SmartSelectorRuleEditor({ rule, editing, writable, saving, canSave, error, update, remove, openEditor, closeEditor, saveEditor }: {
  rule: DraftRule; editing: boolean; writable: boolean; saving: boolean; canSave: boolean; error?: string
  update: (rule: DraftRule) => void; remove: () => void; openEditor: () => void; closeEditor: () => void; saveEditor: () => void
}): React.ReactNode {
  const [expandedActionId, setExpandedActionId] = React.useState<string | null>(null)
  const [toolNames, setToolNames] = React.useState<string[]>([])
  const [capabilities, setCapabilities] = React.useState<{ events: { key: string; display: string; parameters?: { key: string; display: string }[] }[]; adapters: { key: string; display: string; available?: boolean; parameters?: { key: string; display: string; required?: boolean; defaultValue?: string; kind?: 'boolean' | 'number' }[] }[] }>({ events: [], adapters: [] })
  React.useEffect(() => { if (!editing) setExpandedActionId(null) }, [editing])
  React.useEffect(() => {
    if (!editing || !rule.phase.startsWith('tool-')) return
    let active = true
    void fetch('/api/dsh-smart-selector/tools').then(response => response.json()).then((value: { tools?: string[] }) => {
      if (active && Array.isArray(value.tools)) setToolNames(value.tools)
    }).catch(() => { if (active) setToolNames([]) })
    return () => { active = false }
  }, [editing, rule.phase])
  React.useEffect(() => {
    if (!editing) return
    let active = true
    void fetch('/api/dsh-smart-selector/capabilities').then(response => response.json()).then(value => {
      if (active && Array.isArray(value.events) && Array.isArray(value.adapters)) setCapabilities(value)
    }).catch(() => { if (active) setCapabilities({ events: [], adapters: [] }) })
    return () => { active = false }
  }, [editing])
  const set = (changes: Partial<DraftRule>): void => update({ ...rule, ...changes })
  const updateOption = (id: string, changes: Partial<RuleOption>): void =>
    set({ options: rule.options.map(option => option.id === id ? { ...option, ...changes } : option) })
  const changeEvent = (value: string): void => {
    if (value !== 'before' && value !== 'after' && value !== 'skill-injection' && value !== 'skill-catalog' && value !== 'tool-before' && value !== 'tool-after' && value !== 'external') return
    if (value === 'before') set({ phase: value, candidateSource: 'none', input: 'latest-user-message', question: '', thresholdPercent: '80',
      options: [
        { id: 'option-a', label: '', action: { type: 'none', text: '' } },
        { id: 'option-b', label: '', action: { type: 'none', text: '' } },
      ] })
    else if (value === 'after') set({ phase: value, candidateSource: 'none', input: 'tool-results', question: '', thresholdPercent: '80',
      options: [
        { id: 'option-a', label: '', action: { type: 'none', text: '' } },
        { id: 'option-b', label: '', action: { type: 'none', text: '' } },
      ] })
    else if (value === 'tool-before' || value === 'tool-after') set({ phase: value, toolName: rule.toolName || '*', candidateSource: 'none', input: value === 'tool-before' ? 'tool-call' : 'tool-result', question: rule.question, thresholdPercent: '80', options: value === 'tool-after' && rule.candidateSource === 'none'
      ? rule.options.map(option => ({ ...option, action: ['none', 'inject-context', 'dispatch'].includes(option.action.type) ? option.action : { type: 'none', text: '' } }))
      : [{ id: 'option-a', label: '', action: { type: 'none', text: '' } }, { id: 'option-b', label: '', action: { type: 'none', text: '' } }] })
    else if (value === 'skill-injection') set({ phase: value, candidateSource: 'none', input: 'skill-summary', question: '', thresholdPercent: '80',
      options: [
        { id: 'option-a', label: '', action: { type: 'none', text: '' } },
        { id: 'option-b', label: '', action: { type: 'none', text: '' } },
      ] })
    else if (value === 'external') set({ phase: value, eventKey: '', eventDisplay: '', input: 'event-param', inputParameterKey: '', inputParameterDisplay: '', candidateSource: 'none', question: rule.question, thresholdPercent: '80', options: rule.candidateSource === 'none'
      ? rule.options.map(option => ({ ...option, action: ['none', 'inject-context', 'dispatch'].includes(option.action.type) ? option.action : { type: 'none', text: '' } }))
      : [{ id: 'option-a', label: '', action: { type: 'none', text: '', params: [] } }, { id: 'option-b', label: '', action: { type: 'none', text: '', params: [] } }] })
    else set({ phase: value, candidateSource: 'event-params', candidateParameterKey: 'skills', title: rule.title || 'Skill 裁剪', input: 'current-context-text', question: '与当前上下文最相关的 Skill 有哪些？', thresholdPercent: '0',
      selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '', options: [] })
  }
  const changeCandidateSource = (value: string): void => {
    if (!['none', 'event-params', 'custom-list', 'input-split', 'script'].includes(value)) return
    if (value === 'none') set({ candidateSource: 'none', question: '', thresholdPercent: '80', options: [
      { id: 'option-a', label: '', action: { type: 'none', text: '' } },
      { id: 'option-b', label: '', action: { type: 'none', text: '' } },
    ] })
    else set({ candidateSource: value as Rule['candidateSource'], input: value === 'input-split' ? 'latest-user-message' : rule.phase === 'external' ? rule.input : 'current-context-text',
      question: '哪些选项与待判断内容最相关？', thresholdPercent: '0', splitMode: 'newline', splitText: '',
      selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '', options: [] })
  }
  const ranking = rule.candidateSource !== 'none'
  const questionType = rule.questionType ?? (ranking ? 'noul' : 'choice')
  const invalidNoulOptions = !ranking && questionType === 'noul' && rule.options.length !== 2
  const sourceDescription = rule.input === 'custom-text'
    ? '使用下方输入的固定文字；每次事件发生都会读取它。'
    : rule.input === 'user-message-with-skills'
      ? '运行时读取最新用户消息，并附上本规则选项所指向、允许模型调用的 Skill 名称与简介；找不到候选 Skill 时不判断。'
    : rule.phase === 'skill-catalog'
      ? rule.input === 'latest-user-message'
        ? '运行时读取当前可见的最新一条用户消息；候选选项由当时可用的 Skill 名称与简介动态生成。'
        : '运行时读取当前会话仍可见的文字和这一步的新消息，长度受上下文预算限制；候选选项由当时可用的 Skill 名称与简介动态生成。'
    : rule.phase === 'external'
      ? '由事件提供者按事件标识触发。参数以 key 取值，显示名称不参与匹配；未连接提供者时规则不会触发。'
    : rule.phase.startsWith('tool-')
      ? '按选定的工具名称触发；可判断本次调用参数、结果或当前会话文本。'
    : rule.input === 'skill-summary'
      ? '每次智能规则选中 Skill 后、加载正文前触发；输入包含本次 Skill 名称、简介和最新用户消息。题目和选项由本规则配置。'
    : rule.input === 'skill-content'
      ? '输入为本次 Skill 名称和完整正文；超过判定输入上限时，本次注入不执行。'
    : rule.input === 'current-context-text'
      ? '运行时从当前步骤可见消息中提取所有文本；不包含图片或文件内容。'
      : rule.input === 'tool-results'
        ? '运行时读取本轮工具结果的 ID、成功状态和文字；没有工具结果时不判断。'
        : '运行时读取最新一条用户消息的文字；不包含整段会话、图片或文件。'
  const title = rule.title.trim()
  const description = rule.description.trim()
  const displayTitle = title || description || '未命名规则'
  return <article className={styles.ruleCard}>
    <div className={styles.ruleHeader}>
      <div className={styles.ruleSummary}>
        <strong>{displayTitle}</strong>
        {title && description && <span className={styles.ruleDescription}>{description}</span>}
      </div>
      <div className={styles.ruleControls}><Switch checked={rule.enabled} disabled={!writable} label={`启用${displayTitle}`} onChange={enabled => set({ enabled })} /><Button variant="outline" size="sm" onClick={openEditor}>编辑</Button></div>
    </div>
    <Modal open={editing} onClose={closeEditor} title={displayTitle} closeLabel="关闭规则编辑" className={styles.ruleEditorModal} contentClassName={styles.ruleEditorContent}
      footer={<><Button variant="ghost" size="sm" onClick={closeEditor}>取消</Button><Button variant="primary" size="sm" disabled={!canSave || saving || invalidNoulOptions} onClick={saveEditor}>{saving ? '正在保存…' : '保存规则'}</Button></>}>
      <div className={styles.ruleBody}>
      <QuestionTypePicker value={questionType} disabled={!writable} onChange={questionType => set({ questionType })} />
      <p className={styles.note}>{questionType === 'choice' ? '选择题：各选项相互竞争，返回概率分布。' : questionType === 'noul' ? ranking ? '判断题：独立判断每个候选是否符合题目，返回符合概率。' : '判断题：第一项对应“是”，第二项对应“否”；执行概率达到阈值的结果。' : ranking ? '评分题：按下方从低到高的等级评价每个候选，归一为 0–100% 后筛选。' : '评分题：下方选项按等级从低到高排列。按期望分数最接近的等级执行动作，该等级概率须达到执行阈值。'}</p>
      {invalidNoulOptions && <p className={styles.error} role="alert">判断题需要两个选项。现有选项和动作已保留，请移除多余项，或切回原题型。</p>}
      {ranking && questionType === 'score' && <label className={styles.field}>评分等级（从低到高，每行一级）<textarea className={styles.textarea} rows={3} disabled={!writable} value={(rule.scoreLevels ?? ['不相关', '部分相关', '高度相关']).join('\n')} onChange={event => set({ scoreLevels: event.currentTarget.value.split('\n') })} /></label>}
      <label className={styles.field}>规则标题<Input value={rule.title} maxLength={120} disabled={!writable} placeholder="例如：先查证据" onChange={event => set({ title: event.currentTarget.value })} /></label>
      <label className={styles.field}>规则说明<Input value={rule.description} maxLength={500} disabled={!writable} placeholder="用一句话说明这条规则的用途" onChange={event => set({ description: event.currentTarget.value })} /></label>
      <div className={styles.ruleStage}>
        <div className={styles.contextFields}>
          <Choice label="事件" value={rule.phase} disabled={!writable} choices={EVENT_DEFINITIONS.map(event => ({ id: event.key, label: event.display }))} onSelect={changeEvent} />
          <Choice label="待判断内容" value={rule.input} disabled={!writable} choices={rule.phase.startsWith('tool-')
            ? [{ id: 'tool-call', label: inputNames['tool-call'] }, { id: 'tool-result', label: inputNames['tool-result'] }, { id: 'current-context-text', label: inputNames['current-context-text'] }, { id: 'custom-text', label: inputNames['custom-text'] }]
            : rule.phase === 'external' ? [{ id: 'event-param', label: inputNames['event-param'] }, { id: 'current-context-text', label: inputNames['current-context-text'] }, { id: 'custom-text', label: inputNames['custom-text'] }]
            : rule.phase === 'before'
            ? [{ id: 'latest-user-message', label: inputNames['latest-user-message'] }, { id: 'current-context-text', label: inputNames['current-context-text'] }, ...(ranking ? [] : [{ id: 'user-message-with-skills', label: inputNames['user-message-with-skills'] }]), { id: 'custom-text', label: inputNames['custom-text'] }]
            : rule.phase === 'after' ? [{ id: 'tool-results', label: inputNames['tool-results'] }, { id: 'custom-text', label: inputNames['custom-text'] }]
              : rule.phase === 'skill-catalog' ? [{ id: 'current-context-text', label: inputNames['current-context-text'] }, { id: 'latest-user-message', label: inputNames['latest-user-message'] }, { id: 'custom-text', label: inputNames['custom-text'] }]
                : [{ id: 'skill-summary', label: inputNames['skill-summary'] }, { id: 'skill-content', label: inputNames['skill-content'] }, { id: 'latest-user-message', label: inputNames['latest-user-message'] }, { id: 'current-context-text', label: inputNames['current-context-text'] }, { id: 'custom-text', label: inputNames['custom-text'] }]} onSelect={input => set({ input })} />
        </div>
        {rule.phase.startsWith('tool-') && <div className={styles.contextFields}>
          <Choice label="监听工具" value={rule.toolName} disabled={!writable} choices={[{ id: '*', label: '全部工具' }, ...[...new Set([rule.toolName, ...toolNames].filter(name => name && name !== '*'))].map(name => ({ id: name, label: name }))]} onSelect={toolName => set({ toolName })} />
          <label className={styles.field}>工具名称<Input value={rule.toolName} maxLength={120} disabled={!writable} placeholder="输入确切工具名，或 *" onChange={event => set({ toolName: event.currentTarget.value })} /></label>
        </div>}
        {rule.phase === 'external' && <div className={styles.contextFields}>
          <Choice label="已连接的事件" value={rule.eventKey} disabled={!writable} choices={capabilities.events.map(item => ({ id: item.key, label: item.display }))} onSelect={eventKey => set({ eventKey, eventDisplay: capabilities.events.find(item => item.key === eventKey)?.display ?? rule.eventDisplay })} />
          <label className={styles.field}>事件 key<Input value={rule.eventKey} maxLength={120} disabled={!writable} placeholder="例如 message.received" onChange={event => set({ eventKey: event.currentTarget.value })} /></label>
          <label className={styles.field}>显示名称<Input value={rule.eventDisplay} maxLength={120} disabled={!writable} placeholder="例如 监听群消息" onChange={event => set({ eventDisplay: event.currentTarget.value })} /></label>
        </div>}
        {rule.phase === 'external' && rule.eventKey && !capabilities.events.some(item => item.key === rule.eventKey) && <p className={styles.actionPreview}>尚无提供者注册此事件；规则可保存，连接提供者后才会触发。</p>}
        <details className={styles.helpDetails}><summary>待判断内容说明</summary><p>{sourceDescription}</p></details>
        {rule.input === 'custom-text' && <label className={styles.field}>自定义待判断内容<textarea className={styles.textarea} value={rule.customInput} maxLength={24000} disabled={!writable} rows={3} placeholder="输入每次事件发生时供判定的固定内容" onChange={event => set({ customInput: event.currentTarget.value })} /></label>}
        {rule.phase === 'external' && rule.input === 'event-param' && <div className={styles.contextFields}><Choice label="事件参数" value={rule.inputParameterKey} disabled={!writable}
          choices={capabilities.events.find(item => item.key === rule.eventKey)?.parameters?.map(parameter => ({ id: parameter.key, label: parameter.display })) ?? []} onSelect={inputParameterKey => set({ inputParameterKey })} />
          <label className={styles.field}>参数 key<Input value={rule.inputParameterKey} maxLength={120} disabled={!writable} placeholder="例如 message" onChange={event => set({ inputParameterKey: event.currentTarget.value })} /></label></div>}
        {rule.phase === 'external' && rule.input === 'event-param' && <label className={styles.field}>参数显示名称<Input value={rule.inputParameterDisplay} maxLength={120} disabled={!writable} placeholder="例如 收到的消息" onChange={event => set({ inputParameterDisplay: event.currentTarget.value })} /></label>}
      </div>
      {rule.phase === 'before' && <div className={styles.ruleStage}>
        <Choice label="选项与行为" value={rule.candidateSource} disabled={!writable} choices={[{ id: 'none', label: '手动配置' }, { id: 'input-split', label: '待判断内容作为选项' }, { id: 'custom-list', label: '固定内容逐行作为选项' }, { id: 'script', label: '脚本生成选项' }]} onSelect={changeCandidateSource} />
        {rule.candidateSource === 'custom-list' && <label className={styles.field}>选项（每行一项）<textarea className={styles.codeArea} value={rule.candidateText} maxLength={64000} disabled={!writable} rows={7} placeholder="注意事项一\n注意事项二\n注意事项三" onChange={event => set({ candidateText: event.currentTarget.value })} /></label>}
        {rule.candidateSource === 'input-split' && <><Choice label="分割方式" value={rule.splitMode} disabled={!writable} choices={[{ id: 'newline', label: '换行' }, { id: 'space', label: '空格' }, { id: 'literal', label: '特定字符串' }]} onSelect={splitMode => set({ splitMode: splitMode as Rule['splitMode'] })} />
          {rule.splitMode === 'literal' && <label className={styles.field}>分隔字符串<Input value={rule.splitText} maxLength={100} disabled={!writable} placeholder="例如：|||" onChange={event => set({ splitText: event.currentTarget.value })} /></label>}</>}
        {rule.candidateSource === 'script' && <><label className={styles.field}>选项生成脚本<textarea className={styles.codeArea} value={rule.candidateScript} maxLength={16000} disabled={!writable} rows={7} spellCheck={false} placeholder={"const fs = await import('node:fs/promises')\nreturn (await fs.readFile('C:/rules/notes.txt', 'utf8')).split('\\n').filter(Boolean)"} onChange={event => set({ candidateScript: event.currentTarget.value })} /></label>
          <details className={styles.helpDetails}><summary>脚本接口说明</summary><p>脚本接收 <code>event</code> 和 <code>input</code>，返回文字数组，或 <code>{'[{ id, text }]'}</code>。可读取本机文件；每次事件发生时重新执行。</p></details></>}
      </div>}
      {rule.phase === 'skill-catalog' && <div className={styles.ruleStage}><Choice label="选项与行为" value="event-params" disabled choices={[{ id: 'event-params', label: '事件参数作为选项' }]} onSelect={() => {}} />
        <Choice label="参数" value={rule.candidateParameterKey} disabled={!writable} choices={optionParametersForEvent(rule.phase).map(parameter => ({ id: parameter.key, label: parameter.display }))} onSelect={candidateParameterKey => set({ candidateParameterKey })} /></div>}
      {rule.phase === 'external' && <div className={styles.ruleStage}>
        <Choice label="选项与行为" value={rule.candidateSource} disabled={!writable} choices={[{ id: 'none', label: '手动配置' }, { id: 'event-params', label: '事件参数作为选项' }]} onSelect={changeCandidateSource} />
        {rule.candidateSource === 'event-params' && <><div className={styles.contextFields}>
          <Choice label="候选参数" value={rule.candidateParameterKey} disabled={!writable}
            choices={capabilities.events.find(event => event.key === rule.eventKey)?.parameters?.map(parameter => ({ id: parameter.key, label: parameter.display })) ?? []}
            onSelect={candidateParameterKey => set({ candidateParameterKey, candidateParameterDisplay: capabilities.events.find(event => event.key === rule.eventKey)?.parameters?.find(parameter => parameter.key === candidateParameterKey)?.display ?? '' })} />
          <label className={styles.field}>候选参数 key<Input value={rule.candidateParameterKey} disabled={!writable} placeholder="例如 items" onChange={event => set({ candidateParameterKey: event.currentTarget.value })} /></label></div>
          <label className={styles.field}>候选参数显示名称<Input value={rule.candidateParameterDisplay} disabled={!writable} placeholder="例如 待筛选事项" onChange={event => set({ candidateParameterDisplay: event.currentTarget.value })} /></label>
          <p className={styles.actionPreview}>事件提供者传入文字数组或带 id、text 的列表；智能规则一次评分，裁剪结果通过事件返回值交还提供者。</p></>}
      </div>}
      <div className={styles.ruleStage}><div className={styles.stageHeading}><strong>题目</strong></div>
        <div className={styles.questionControls}>
          <Choice label="生成方式" value={rule.questionSource} disabled={!writable} choices={[{ id: 'configured', label: '直接配置' }, { id: 'script', label: '自定义脚本' }]} onSelect={value => set({ questionSource: value as DraftRule['questionSource'] })} />
          {!ranking && <label className={styles.field}>执行阈值（%）<Input type="number" min="0" max="100" step="1" value={rule.thresholdPercent} disabled={!writable} onChange={event => set({ thresholdPercent: event.currentTarget.value })} /></label>}
        </div>
        {rule.questionSource === 'configured' ? <label className={styles.field}>题目标题<Input value={rule.question} maxLength={8000} disabled={!writable} placeholder="例如：这条消息是否需要先检查证据？" onChange={event => set({ question: event.currentTarget.value })} /></label>
          : <><label className={styles.field}>题目生成脚本<textarea className={styles.codeArea} value={rule.questionScript} maxLength={16000} disabled={!writable} rows={7} spellCheck={false} placeholder={ranking ? "// options 是本次生成的真实候选项\nreturn { title: '哪些选项与当前内容最相关？', options }" : "// 可使用 event、input、options；支持 await import('node:fs/promises')\nreturn { title: '这条消息是否需要检查证据？', options }"} onChange={event => set({ questionScript: event.currentTarget.value })} /></label>
            <details className={styles.helpDetails}><summary>脚本接口说明</summary><p>脚本在本机工作线程执行，可读取文件。返回 <code>{'{ title, options: [{ id, label }] }'}</code>；{ranking ? 'options 是本次真实候选项，可调整文案，也可只返回 title。' : '选项 ID 与下方一致，行为仍由规则配置决定。'}</p></details></>}
      </div>
      {ranking && <div className={styles.ruleStage}><div className={styles.stageHeading}><strong>筛选与行为</strong></div>
        <div className={styles.contextFields}><Choice label="筛选目标" value={rule.selectionMode} disabled={!writable} choices={[{ id: 'score-below', label: '评分小于 N' }, { id: 'score-above', label: '评分大于 N' }, { id: 'top', label: '评分前 N 个' }, { id: 'bottom', label: '评分后 N 个' }]} onSelect={selectionMode => set({ selectionMode: selectionMode as Rule['selectionMode'], selectionValue: selectionMode.startsWith('score-') ? '80' : '10', thresholdPercent: '0' })} />
          <label className={styles.field}>{rule.selectionMode.startsWith('score-') ? 'N（%）' : 'N（个）'}<Input type="number" min={rule.selectionMode.startsWith('score-') ? '0' : '1'} max={rule.selectionMode.startsWith('score-') ? '100' : undefined} step="1" value={rule.selectionValue} disabled={!writable} onChange={event => set({ selectionValue: event.currentTarget.value })} /></label></div>
        {(rule.selectionMode === 'top' || rule.selectionMode === 'bottom') && <details className={styles.helpDetails}><summary>附加最低评分{rule.thresholdPercent !== '0' ? `：${rule.thresholdPercent}%` : ''}</summary><label className={styles.field}>最低评分（%）<Input type="number" min="0" max="100" step="1" value={rule.thresholdPercent} disabled={!writable} onChange={event => set({ thresholdPercent: event.currentTarget.value })} /></label></details>}
        <Choice label="设置行为" value={rule.selectionAction} disabled={!writable} choices={[{ id: 'prune', label: '裁剪' }, { id: 'inject-extra', label: '注入额外内容' }]} onSelect={selectionAction => set({ selectionAction: selectionAction as Rule['selectionAction'] })} />
        {rule.selectionAction === 'inject-extra' && <label className={styles.field}>额外内容<textarea className={styles.textarea} value={rule.selectionActionText} maxLength={8000} disabled={!writable} rows={3} placeholder="可用 {selected} 插入筛选出的选项" onChange={event => set({ selectionActionText: event.currentTarget.value })} /></label>}
        <p className={styles.actionPreview}>每个选项只评分一次。{rule.selectionAction === 'prune' ? rule.phase === 'skill-catalog' ? '把筛选结果返回给 Skill 目录事件，替换本次目录。' : rule.phase === 'external' ? '把入选项交还事件提供者，由提供者裁剪它拥有的内容。' : '仅把筛选结果传入本次会话，保留原用户消息。' : '选中至少一项时注入上方内容；{selected} 表示入选项。'}</p>
      </div>}
      <div className={styles.ruleStage}><div className={styles.stageHeading}><strong>{ranking ? '动态选项' : questionType === 'score' ? '评分等级与行为（从低到高）' : '选项与行为'}</strong>{!ranking && <span>{rule.options.length} 个选项</span>}</div>
        {ranking && <p className={styles.actionPreview}>模型一次接收全部选项并返回每项评分；此处的选项来自上方选择的内容或事件参数。</p>}
        {!ranking && <div className={styles.ruleOptions}>{rule.options.map((option, optionIndex) => <div className={styles.ruleOption} key={option.id}>
          <div className={styles.optionTitle}><span className={styles.optionLetter}>{questionType === 'noul' ? optionIndex === 0 ? '是' : optionIndex === 1 ? '否' : '多余' : questionType === 'score' ? optionIndex : String.fromCharCode(65 + optionIndex)}</span><label className={styles.field}>选项文案<Input value={option.label} maxLength={800} disabled={!writable} aria-label={`${displayTitle}，选项 ${optionIndex + 1}`} onChange={event => updateOption(option.id, { label: event.currentTarget.value })} /></label>
            <Button variant="ghost" size="sm" disabled={!writable || rule.options.length <= 2} onClick={() => set({ options: rule.options.filter(item => item.id !== option.id) })}>移除</Button></div>
          <div className={styles.optionActionControls}>
            <Choice label="命中后" value={option.action.type} disabled={!writable} choices={rule.phase === 'before'
              ? [{ id: 'none', label: actionNames.none }, { id: 'inject-context', label: actionNames['inject-context'] }, { id: 'inject-skill', label: actionNames['inject-skill'] }]
              : rule.phase === 'after' ? [{ id: 'none', label: actionNames.none }, { id: 'append-reminder', label: actionNames['append-reminder'] }]
                : rule.phase === 'tool-before' ? [{ id: 'none', label: actionNames.none }, { id: 'deny-tool', label: actionNames['deny-tool'] }]
                  : rule.phase === 'tool-after' || rule.phase === 'external' ? [{ id: 'none', label: actionNames.none }, { id: 'inject-context', label: actionNames['inject-context'] }, { id: 'dispatch', label: actionNames.dispatch }]
                : rule.phase === 'skill-catalog' ? [{ id: 'none', label: actionNames.none }, { id: 'keep-top-skills', label: actionNames['keep-top-skills'] }]
                  : [{ id: 'none', label: '继续注入' }, { id: 'skip-skill', label: actionNames['skip-skill'] }, { id: 'inject-context', label: actionNames['inject-context'] }]}
              onSelect={type => { updateOption(option.id, { action: { type: type as Action['type'], text: type === option.action.type ? option.action.text : '', params: type === option.action.type ? option.action.params : type === 'dispatch' ? [
                { key: 'adapter', display: '适配器', value: 'tool' }, { key: 'toolName', display: '工具名称', value: '' }, { key: 'messageArgument', display: '消息参数名', value: 'text' },
              ] : [] } }); if (!['none', 'skip-skill'].includes(type)) setExpandedActionId(option.id) }} />
            {!['none', 'skip-skill'].includes(option.action.type) && <Button variant="outline" size="sm" aria-expanded={expandedActionId === option.id} aria-controls={`jev-action-${rule.id}-${option.id}`} onClick={() => setExpandedActionId(current => current === option.id ? null : option.id)}>{expandedActionId === option.id ? '收起内容' : option.action.text.trim() ? '编辑内容' : '填写内容'}</Button>}
          </div>
          {!['none', 'skip-skill'].includes(option.action.type) && (expandedActionId === option.id
            ? <div id={`jev-action-${rule.id}-${option.id}`}><label className={styles.field}>{option.action.type === 'inject-skill' ? 'Skill 名称' : option.action.type === 'dispatch' ? '生成消息的要求' : '动作内容'}{option.action.type === 'inject-skill'
              ? <Input value={option.action.text} maxLength={120} disabled={!writable} placeholder="输入可用的 Skill 名称，例如 code-review" onChange={event => updateOption(option.id, { action: { ...option.action, text: event.currentTarget.value } })} />
              : option.action.type === 'keep-top-skills'
                ? <Input type="number" min="1" max="50" step="1" value={option.action.text} disabled={!writable} aria-label="保留 Skill 数量" onChange={event => updateOption(option.id, { action: { ...option.action, text: event.currentTarget.value } })} />
              : <textarea className={styles.textarea} value={option.action.text} maxLength={8000} disabled={!writable} rows={3} placeholder="选中此选项时使用的文字" onChange={event => updateOption(option.id, { action: { ...option.action, text: event.currentTarget.value } })} />}</label>
              {option.action.type === 'dispatch' && <div className={styles.ruleStage}>
                <Choice label="动作适配器" value={option.action.params?.find(parameter => parameter.key === 'adapter')?.value ?? ''} disabled={!writable}
                  choices={capabilities.adapters.map(adapter => ({ id: adapter.key, label: adapter.available === false ? `${adapter.display}（未安装）` : adapter.display }))}
                  onSelect={adapter => updateOption(option.id, { action: { ...option.action, params: [{ key: 'adapter', display: '适配器', value: adapter },
                    ...(capabilities.adapters.find(item => item.key === adapter)?.parameters ?? []).map(parameter => ({ key: parameter.key, display: parameter.display,
                      value: (option.action.params ?? []).find(old => old.key === parameter.key)?.value ?? parameter.defaultValue ?? '' }))] } })} />
                <details className={styles.helpDetails}><summary>手动指定适配器 key</summary><label className={styles.field}>适配器 key<Input value={option.action.params?.find(parameter => parameter.key === 'adapter')?.value ?? ''} disabled={!writable} placeholder="例如 tool" onChange={event => updateOption(option.id, { action: { ...option.action, params: [{ key: 'adapter', display: '适配器', value: event.currentTarget.value }, ...(option.action.params ?? []).filter(parameter => parameter.key !== 'adapter')] } })} /></label></details>
                {capabilities.adapters.find(adapter => adapter.key === option.action.params?.find(parameter => parameter.key === 'adapter')?.value)?.available === false && <p className={styles.actionPreview}>此适配器尚未安装；其他规则仍可运行，这项动作要等适配器可用后才会执行。</p>}
                {capabilities.adapters.find(adapter => adapter.key === option.action.params?.find(parameter => parameter.key === 'adapter')?.value)?.parameters?.some(parameter => parameter.required && !(option.action.params ?? []).some(value => value.key === parameter.key && value.value.trim())) && <p className={styles.actionPreview}>动作参数尚未填写完整，运行时不会发送。请填写此适配器的必填项。</p>}
                {(option.action.params ?? []).filter(parameter => parameter.key !== 'adapter').map((parameter, index) => {
                  const definition = capabilities.adapters.find(adapter => adapter.key === option.action.params?.find(item => item.key === 'adapter')?.value)?.parameters?.find(item => item.key === parameter.key)
                  const updateValue = (value: string): void => updateOption(option.id, { action: { ...option.action, params: (option.action.params ?? []).map(item => item === parameter ? { ...item, value } : item) } })
                  return <div className={styles.contextFields} key={`${parameter.key}-${index}`}>
                    {!definition && <><label className={styles.field}>参数 key<Input value={parameter.key} disabled={!writable} placeholder="例如 arg.channel" onChange={event => updateOption(option.id, { action: { ...option.action, params: (option.action.params ?? []).map(item => item === parameter ? { ...item, key: event.currentTarget.value } : item) } })} /></label>
                      <label className={styles.field}>显示名称<Input value={parameter.display} disabled={!writable} placeholder="给人看的名称" onChange={event => updateOption(option.id, { action: { ...option.action, params: (option.action.params ?? []).map(item => item === parameter ? { ...item, display: event.currentTarget.value } : item) } })} /></label></>}
                    {definition?.kind === 'boolean' ? <Choice label={`${definition.display} · ${parameter.key}`} value={parameter.value} disabled={!writable} choices={[{ id: 'true', label: '是' }, { id: 'false', label: '否' }]} onSelect={updateValue} />
                      : <label className={styles.field}>{definition?.display || parameter.display || '参数值'} · {parameter.key}<Input type={definition?.kind === 'number' ? 'number' : 'text'} value={parameter.value} disabled={!writable} onChange={event => updateValue(event.currentTarget.value)} /></label>}
                    <Button variant="ghost" size="sm" disabled={!writable || definition?.required} onClick={() => updateOption(option.id, { action: { ...option.action, params: (option.action.params ?? []).filter(item => item !== parameter) } })}>移除</Button>
                  </div>
                })}
                <Button variant="outline" size="sm" disabled={!writable || (option.action.params?.length ?? 0) >= 32} onClick={() => updateOption(option.id, { action: { ...option.action, params: [...(option.action.params ?? []), { key: '', display: '', value: '' }] } })}>添加动作参数</Button>
              </div>}</div>
            : <p className={styles.actionPreview}>{option.action.text.trim() || '尚未填写动作内容'}</p>)}
        </div>)}</div>}
        {!ranking && <Button variant="outline" size="sm" disabled={!writable || rule.options.length >= (questionType === 'noul' ? 2 : 16)} onClick={() => set({ options: [...rule.options, { id: `option-${crypto.randomUUID().replaceAll('-', '')}`, label: '', action: { type: 'none', text: '' } }] })}>添加选项</Button>}
      </div>
      <div className={styles.ruleFooter}><Button variant="ghost" size="sm" disabled={!writable} onClick={remove}>删除规则</Button></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  </article>
}
