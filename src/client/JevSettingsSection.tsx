import * as React from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogPickerProps } from 'dsh-codex-model-selector/model-picker'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import styles from './JevSettingsSection.module.css'
import { modeForModel, unsupportedModelReason } from '../mode.mjs'
import { decisionModelGroups, selectionPatch } from '../model-selection.mjs'
import { validateRules } from '../policy.mjs'
import { groupRulePresets } from '../settings.mjs'
import { JevTestPage } from './JevTestPage.tsx'
import { JevRuleEditor } from './JevRuleEditor.tsx'
import type { DraftRule, Rule } from './JevRuleEditor.tsx'

export type Settings = { enabled: boolean; provider: string; model: string; decisionApi: { enabled: boolean; model: string; timeoutMs: number }; messageModel: { provider: string; model: string }; nativeJev: boolean; beforeEnabled: boolean; afterEnabled: boolean; maxContextCharacters: number; maxCorrections: number; presetVersion: number; rules: Rule[] }
export type ModelPickerSource = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => React.ComponentType<CatalogPickerProps> | undefined
}
type Injected = { scope: ConfigForm<Settings>; loadCatalog: () => Promise<ModelCatalog>; modelPicker: ModelPickerSource }
export type JevSettingsSectionProps = Partial<Injected> & { close?: () => void }

const toDraft = (rules: Rule[]): DraftRule[] =>
  validateRules(rules).map(({ threshold, ...rule }) => ({ ...rule, thresholdPercent: String(Math.round(threshold * 100)) }))

function validateDraft(rules: DraftRule[]): Rule[] {
  if (rules.length > 64) throw new Error('最多只能保存 64 条规则。')
  return rules.map(rule => {
    const label = `规则「${rule.title.trim() || rule.description.trim() || '未命名'}」`
    if (rule.title.length > 120) throw new Error(`${label}的标题不能超过 120 字。`)
    if (rule.description.length > 500) throw new Error(`${label}的说明不能超过 500 字。`)
    if (rule.questionSource === 'configured' && !rule.question.trim()) throw new Error(`${label}缺少题目标题。`)
    if (rule.questionSource === 'script' && !rule.questionScript.trim()) throw new Error(`${label}缺少题目生成脚本。`)
    if (rule.input === 'custom-text' && !rule.customInput.trim()) throw new Error(`${label}缺少自定义待判断内容。`)
    if (rule.input === 'user-message-with-skills' && !rule.options.some(option => option.action.type === 'inject-skill')) throw new Error(`${label}需要至少一个注入 Skill 的选项。`)
    if (rule.candidateSource === 'custom-list' && rule.candidateText.split(/\r?\n/).filter(item => item.trim()).length < 2) throw new Error(`${label}至少需要两条候选内容。`)
    if (rule.candidateSource === 'input-split' && rule.splitMode === 'literal' && !rule.splitText) throw new Error(`${label}缺少分隔字符串。`)
    if (rule.candidateSource === 'script' && !rule.candidateScript.trim()) throw new Error(`${label}缺少候选生成脚本。`)
    if (rule.candidateSource !== 'none' && (rule.selectionMode === 'top' || rule.selectionMode === 'bottom'
      ? !/^[1-9][0-9]*$/.test(rule.selectionValue) || !Number.isSafeInteger(Number(rule.selectionValue))
      : !rule.selectionValue.trim() || !Number.isFinite(Number(rule.selectionValue)) || Number(rule.selectionValue) < 0 || Number(rule.selectionValue) > 100)) throw new Error(`${label}的筛选目标 N 无效。`)
    if (rule.candidateSource !== 'none' && rule.selectionAction === 'inject-extra' && !rule.selectionActionText.trim()) throw new Error(`${label}缺少额外注入内容。`)
    if (rule.candidateSource === 'none' && rule.questionType === 'noul' && rule.options.length !== 2) throw new Error(`${label}的判断题需要两个选项，第一项为是，第二项为否。`)
    if (rule.candidateSource !== 'none' && rule.questionType === 'score') {
      const levels = rule.scoreLevels ?? ['不相关', '部分相关', '高度相关']
      if (levels.length < 2 || levels.length > 16 || levels.some(level => !level.trim() || level.length > 800) || new Set(levels.map(level => level.trim())).size !== levels.length) throw new Error(`${label}需要 2 至 16 个不重复的评分等级。`)
    }
    if (rule.options.some(option => option.action.type === 'inject-skill' && (option.action.text.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(option.action.text)))) throw new Error(`${label}的 Skill 名称应为 120 字以内的小写字母、数字和连字符。`)
    if (rule.phase.startsWith('tool-') && !rule.toolName.trim()) throw new Error(`${label}需要选择监听的工具。`)
    if (rule.phase === 'external' && (!rule.eventKey.trim() || rule.input === 'event-param' && !rule.inputParameterKey.trim())) throw new Error(`${label}需要事件 key 和待判断参数 key。`)
    if (rule.phase === 'external' && rule.candidateSource === 'event-params' && !rule.candidateParameterKey.trim()) throw new Error(`${label}需要候选参数 key。`)
    for (const option of rule.options) if (option.action.type === 'dispatch') {
      const params = option.action.params ?? []
      if (!params.some(parameter => parameter.key === 'adapter' && parameter.value.trim()) || params.some(parameter => !parameter.key.trim()) || new Set(params.map(parameter => parameter.key)).size !== params.length) throw new Error(`${label}的动作适配器或参数 key 无效。`)
    }
    if (rule.candidateSource === 'none' && (rule.options.length < 2 || rule.options.length > 16 || rule.options.some(option => !option.label.trim() || (!['none', 'skip-skill'].includes(option.action.type) && !option.action.text.trim())))) throw new Error(`${label}的选项文案或动作参数不完整。`)
    const threshold = Number(rule.thresholdPercent)
    if (!rule.thresholdPercent.trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error(`${label}的阈值应为 0 至 100%。`)
    const { thresholdPercent: _thresholdPercent, ...fields } = rule
    return { ...fields, threshold: threshold / 100 }
  })
}

export function JevSettingsSection(props: JevSettingsSectionProps): React.ReactNode {
  if (!props.scope || !props.loadCatalog || !props.modelPicker) return <p role="alert">智能规则设置服务未注入。</p>
  return <Loaded scope={props.scope} loadCatalog={props.loadCatalog} modelPicker={props.modelPicker} />
}

function Loaded({ scope, loadCatalog, modelPicker }: Injected): React.ReactNode {
  const snapshot = React.useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const current = snapshot.value
  const ModelPicker = React.useSyncExternalStore(modelPicker.subscribe, modelPicker.getSnapshot)
  const [catalog, setCatalog] = React.useState<ModelCatalog>()
  const [catalogError, setCatalogError] = React.useState<string>()
  const [loadingCatalog, setLoadingCatalog] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string>()
  const [rulesError, setRulesError] = React.useState<string>()
  const [draftRules, setDraftRules] = React.useState<DraftRule[] | null>(null)
  const [sourceRules, setSourceRules] = React.useState<string | null>(null)
  const [editingRule, setEditingRule] = React.useState<{ id: string; baseline: DraftRule | null } | null>(null)
  const [page, setPage] = React.useState<'rules' | 'test'>('rules')
  const savingRef = React.useRef(false)
  const request = React.useRef(0)
  const migrating = React.useRef(false)
  React.useEffect(() => () => { request.current += 1 }, [])
  React.useEffect(() => {
    if (!current || !snapshot.writable || current.presetVersion >= 1 || migrating.current) return
    migrating.current = true
    const added = groupRulePresets.filter(rule => !current.rules.some(saved => saved.id === rule.id))
    void scope.mutate([{ op: 'set', path: ['rules'], value: [...current.rules, ...added] }, { op: 'set', path: ['presetVersion'], value: 1 }])
      .catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error)))
      .finally(() => { migrating.current = false })
  }, [current, snapshot.writable, scope])
  const writable = snapshot.writable && snapshot.status === 'ready' && current !== undefined && !saving
  const savedRules = current ? JSON.stringify(validateRules(current.rules)) : null
  const dirty = draftRules !== null && sourceRules !== null && JSON.stringify(draftRules) !== JSON.stringify(toDraft(JSON.parse(sourceRules) as Rule[]))
  const changedElsewhere = dirty && savedRules !== sourceRules
  const modelMode = modeForModel(current?.model ?? '', current?.provider)
  const unsupported = unsupportedModelReason(current?.model ?? '', current?.provider)

  React.useEffect(() => {
    if (!current || (draftRules !== null && dirty)) return
    setDraftRules(toDraft(current.rules))
    setSourceRules(JSON.stringify(validateRules(current.rules)))
    setEditingRule(null)
  }, [savedRules])

  const updateRule = (id: string, changes: Partial<DraftRule>): void => {
    setDraftRules(rules => rules?.map(rule => rule.id === id ? { ...rule, ...changes } : rule) ?? null)
    setRulesError(undefined)
  }
  const discardRules = (): void => {
    if (!current) return
    setDraftRules(toDraft(current.rules))
    setSourceRules(JSON.stringify(validateRules(current.rules)))
    setRulesError(undefined)
  }
  const saveRules = async (): Promise<boolean> => {
    if (!writable || !draftRules || !dirty || changedElsewhere || savingRef.current) return false
    let rules: Rule[]
    try { rules = validateDraft(draftRules) }
    catch (error) { setRulesError(error instanceof Error ? error.message : String(error)); return false }
    savingRef.current = true
    setSaving(true)
    setSaveError(undefined)
    setRulesError(undefined)
    try {
      await scope.mutate([{ op: 'set', path: ['rules'], value: rules }])
      setDraftRules(toDraft(rules))
      setSourceRules(JSON.stringify(validateRules(rules)))
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const closeEditor = (): void => {
    if (!editingRule || savingRef.current) return
    setDraftRules(rules => editingRule.baseline === null
      ? rules?.filter(rule => rule.id !== editingRule.id) ?? null
      : rules?.map(rule => rule.id === editingRule.id ? editingRule.baseline! : rule) ?? null)
    setEditingRule(null)
    setRulesError(undefined)
    setSaveError(undefined)
  }
  const refreshCatalog = (): void => {
    const generation = ++request.current
    setLoadingCatalog(true)
    setCatalog(undefined)
    setCatalogError(undefined)
    void loadCatalog().then(value => {
      if (generation === request.current) setCatalog(value)
    }).catch((error: unknown) => {
      if (generation === request.current) setCatalogError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (generation === request.current) setLoadingCatalog(false)
    })
  }
  const groups = React.useMemo(() => decisionModelGroups(catalog), [catalog])
  const patch = async (value: Partial<Settings>): Promise<boolean> => {
    if (!writable || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    setSaveError(undefined)
    try {
      // Provider and model are one revision-fenced mutation, never two writes.
      await scope.mutate(Object.entries(value).map(([field, next]) => ({ op: 'set' as const, path: [field], value: next })))
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally { savingRef.current = false; setSaving(false) }
  }
  if (page === 'test') return <JevTestPage model={current} onBack={() => setPage('rules')} />
  return <section className={styles.section}>
    <header className={styles.pageHeader}>
      <div><h2>智能规则配置</h2></div>
      <div className={styles.headerActions}>{current && <span className={current.enabled ? styles.statusOn : styles.statusOff}>{current.enabled ? '已启用' : '未启用'}</span>}<Button variant="primary" size="sm" disabled={saving} onClick={() => setPage('test')}>打开测试页面</Button></div>
    </header>
    {snapshot.status !== 'ready' || !current ? <p role="status">{snapshot.status === 'loading' ? '正在读取设置…' : '设置不可用，无法读取或保存。'}</p> : <>
      {!snapshot.writable && <p role="status">当前设置只读，无法保存修改。</p>}
      <div className={styles.panel}>
        <div className={styles.sectionHeading}><h3>运行设置</h3></div>
        <div className={styles.row}><span>启用智能规则</span><Switch checked={current.enabled} disabled={!writable} label="启用智能规则" onChange={enabled => patch({ enabled })} /></div>
        <div className={styles.modelField}><span>判定模型</span>
          {ModelPicker ? <ModelPicker groups={groups} current={current.provider && current.model ? { provider: current.provider, model: current.model } : null}
            locked={!writable} select={selected => patch(selectionPatch(current, selected))} load={refreshCatalog}
            status={loadingCatalog ? 'loading' : catalogError ? 'error' : 'ready'} error={catalogError ?? null} failures={catalog?.failures ?? []} />
            : <p role="alert">模型选择器不可用。请安装或启用“模型与推理选择”插件 0.1.18 或更高版本后重试。</p>}
          <Button variant="ghost" size="sm" disabled={!writable || !(current.provider || current.model)} onClick={() => { void patch(selectionPatch(current, { provider: '', model: '' })) }}>清除独立模型配置</Button>
        </div>
        <div className={styles.testModel}><span>当前判定模型：{current.provider && current.model ? `${current.provider} · ${current.model}` : '未选择'}</span>{(modelMode === 'llm-json' || modelMode === 'unconfigured' || modelMode === 'unsupported') && <span className={styles.modeBadge}>{modelMode === 'llm-json' ? '兼容模式' : modelMode === 'unsupported' ? '不支持通用题型' : '待配置'}</span>}</div>
        {unsupported && <p className={styles.error} role="alert">{unsupported}</p>}
        <p className={styles.note}>各提供商下支持概率判定的模型优先显示；普通模型标注“兼容模式”，使用 LLM JSON 判定。</p>
      </div>

      <div className={styles.panel}>
        <div className={styles.sectionHeading}><h3>规则</h3></div>
        <div className={styles.ruleActions}>
          <Button variant="outline" size="sm" disabled={!writable || (draftRules?.length ?? 0) >= 64} onClick={() => {
            const id = `rule-${crypto.randomUUID().replaceAll('-', '')}`
            setDraftRules(rules => [...(rules ?? []), { id, enabled: true, title: '', description: '', phase: 'before', eventKey: '', eventDisplay: '', inputParameterKey: '', inputParameterDisplay: '', toolName: '', input: 'latest-user-message', customInput: '', candidateSource: 'none', candidateText: '', candidateScript: '', candidateParameterKey: '', candidateParameterDisplay: '',
              splitMode: 'newline', splitText: '', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', selectionActionText: '',
              questionSource: 'configured', questionScript: '', question: '', thresholdPercent: '80',
              options: [{ id: 'yes', label: '是', action: { type: 'inject-context', text: '' } }, { id: 'no', label: '否', action: { type: 'none', text: '' } }] }])
            setEditingRule({ id, baseline: null })
          }}>添加规则</Button>
          <span className={dirty ? styles.unsaved : styles.saved}>{dirty ? '有未保存的修改' : '规则已保存'}</span>
          <Button variant="ghost" size="sm" disabled={!writable || !dirty} onClick={discardRules}>放弃修改</Button>
          <Button variant="primary" size="sm" disabled={!writable || !dirty || changedElsewhere} onClick={() => { void saveRules() }}>保存规则</Button>
        </div>
        <div className={styles.ruleList}>{(draftRules ?? toDraft(current.rules)).map(rule =>
          <JevRuleEditor key={rule.id} rule={rule} editing={editingRule?.id === rule.id} writable={writable} saving={saving} canSave={writable && dirty && !changedElsewhere}
            error={editingRule?.id === rule.id ? rulesError ?? saveError : undefined}
            update={next => updateRule(rule.id, next)}
            remove={() => { setDraftRules(rules => rules?.filter(item => item.id !== rule.id) ?? null); setEditingRule(null) }}
            openEditor={() => { setRulesError(undefined); setSaveError(undefined); setEditingRule({ id: rule.id, baseline: structuredClone(rule) }) }}
            closeEditor={closeEditor}
            saveEditor={() => { void saveRules().then(saved => { if (saved) setEditingRule(null) }) }} />
        )}</div>
        {draftRules?.length === 0 && <p className={styles.empty}>还没有规则。添加一条规则，选择事件并配置题目、选项与行为。</p>}
        {changedElsewhere && <p className={styles.error} role="alert">规则已在别处更新。请放弃本地修改并查看最新内容。</p>}
        {rulesError && <p className={styles.error} role="alert">{rulesError}</p>}
      </div>
      {saving && <p role="status">正在保存…</p>}
      {saveError && <p className={styles.error} role="alert">保存失败：{saveError}。请核对当前设置后重试。</p>}
    </>}
  </section>
}
