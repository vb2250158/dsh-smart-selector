import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { modeForModel, unsupportedModelReason } from '../mode.mjs'
import styles from './SmartSelectorSettingsSection.module.css'
import { QuestionTypePicker, type QuestionType } from './QuestionTypePicker.tsx'

type ChoiceResult = { questionType: QuestionType; noul?: number; score?: number; mode: string; model: string; question: string; selected: string; confidence: number; confidenceKind: string; options: { id: string; label: string; probability: number }[]; durationMs: number }

export type SmartSelectorTestPageProps = {
  model?: { provider: string; model: string }
  onBack: () => void
}

/** One disposable typed decision test, separate from the persisted rule editor. */
export function SmartSelectorTestPage({ model, onBack }: SmartSelectorTestPageProps): React.ReactNode {
  const [state, setState] = React.useState('')
  const [questionType, setQuestionType] = React.useState<QuestionType>('choice')
  const [question, setQuestion] = React.useState('')
  const [options, setOptions] = React.useState(['是', '否'])
  const [result, setResult] = React.useState<ChoiceResult>()
  const [error, setError] = React.useState<string>()
  const [testing, setTesting] = React.useState(false)
  const resultRef = React.useRef<HTMLDivElement>(null)
  const generation = React.useRef(0)
  const controller = React.useRef<AbortController>()
  const mode = modeForModel(model?.model ?? '', model?.provider)
  const unsupported = unsupportedModelReason(model?.model ?? '', model?.provider)
  const configured = Boolean(model?.provider && model.model) && !unsupported
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

  React.useEffect(() => () => { generation.current += 1; controller.current?.abort() }, [])
  React.useEffect(() => { if (result) resultRef.current?.scrollIntoView({ block: 'start' }) }, [result])
  const clearResult = (): void => {
    generation.current += 1
    controller.current?.abort()
    setTesting(false)
    setResult(undefined)
    setError(undefined)
  }
  React.useEffect(() => { clearResult() }, [model?.provider, model?.model])
  const runTest = (): void => {
    if (testing || !configured) return
    const request = ++generation.current
    controller.current?.abort()
    controller.current = new AbortController()
    setTesting(true)
    setResult(undefined)
    setError(undefined)
    void fetch('/api/dsh-smart-selector/test', {
      signal: controller.current.signal, method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, question, options, questionType }),
    }).then(async response => {
      if (!response.ok) throw new Error(`测试接口返回 ${response.status}。`)
      const payload = await response.json() as { ok: boolean; value?: ChoiceResult; error?: string }
      if (!payload.ok || !payload.value) throw new Error(payload.error ?? '测试没有返回结果。')
      if (request === generation.current) setResult(payload.value)
    }).catch((cause: unknown) => {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (request === generation.current) setTesting(false) })
  }

  return <section className={styles.section}>
    <header className={styles.pageHeader}>
      <div><h2>智能规则判定测试</h2><p className={styles.intro}>输入内容、题目和选项，查看选择结果、判断概率或评分。</p></div>
      <Button variant="outline" size="sm" onClick={onBack}>返回规则配置</Button>
    </header>
    <div className={styles.panel}>
      <div className={styles.sectionHeading}><h3>测试一道题</h3><p>测试只调用已配置的判定模型，不写入会话，也不执行规则。</p></div>
      <div className={styles.testModel}><span>判定模型：{model?.provider && model.model ? `${model.provider} · ${model.model}` : '未选择，请返回规则配置页选择'}</span>{(mode === 'llm-json' || mode === 'unconfigured' || mode === 'unsupported') && <span className={styles.modeBadge}>{mode === 'llm-json' ? '兼容模式' : mode === 'unsupported' ? '不支持通用题型' : '待配置'}</span>}</div>
      {unsupported && <p className={styles.error} role="alert">{unsupported}</p>}
      <QuestionTypePicker value={questionType} disabled={testing} onChange={value => { setQuestionType(value); clearResult() }} />
      <p className={styles.note}>{questionType === 'noul' ? '第一项为“是”，第二项为“否”。已有内容保留，需两项才能运行。' : questionType === 'score' ? '选项是从低到高的有序等级，分数范围为 0 至等级数减 1。' : '各选项相互竞争，返回每项概率及最终选择。'}</p>
      <label className={styles.field}>待判断的内容<textarea className={styles.textarea} rows={4} value={state} maxLength={24000} placeholder="粘贴一段消息、工单或其他文本" onChange={event => { setState(event.currentTarget.value); clearResult() }} /></label>
      <label className={styles.field}>题目<Input value={question} maxLength={2000} placeholder="例如：这条消息最需要哪类处理？" onChange={event => { setQuestion(event.currentTarget.value); clearResult() }} /></label>
      <div className={styles.field}><span>{questionType === 'score' ? '评分等级（从低到高）' : '选项'}</span><div className={styles.optionEditor}>{options.map((option, index) =>
        <div className={styles.optionEditRow} key={index}><span className={styles.optionIndex}>{questionType === 'noul' ? index === 0 ? '是' : index === 1 ? '否' : '多余' : questionType === 'score' ? index : String.fromCharCode(65 + index)}</span><Input aria-label={`选项 ${index + 1}`} value={option} maxLength={800} onChange={event => { const value = event.currentTarget.value; setOptions(values => values.map((item, i) => i === index ? value : item)); clearResult() }} /><Button variant="ghost" size="sm" disabled={options.length <= 2} onClick={() => { setOptions(values => values.filter((_, i) => i !== index)); clearResult() }}>移除</Button></div>
      )}</div><Button variant="outline" size="sm" disabled={options.length >= (questionType === 'noul' ? 2 : 16)} onClick={() => { setOptions(values => [...values, '']); clearResult() }}>添加选项</Button></div>
      <div className={styles.testActions}><Button variant="primary" size="sm" disabled={testing || (questionType === 'noul' && options.length !== 2) || !configured || !state.trim() || !question.trim() || options.some(option => !option.trim())} onClick={runTest}>{testing ? '正在测试…' : '运行测试'}</Button><span className={styles.note}>{mode === 'jev-native' ? '读取原生接口返回的概率；有置信度时一并展示。' : '普通模型的选项概率是模型估计值，未经校准。'}</span></div>
      {error && <p className={styles.error} role="alert">测试失败：{error}</p>}
      {result && <div ref={resultRef} className={styles.testResult} aria-label="测试结果">
        <div className={styles.resultHeading}><div><span className={styles.resultEyebrow}>模型选择</span><strong>{result.options.find(option => option.id === result.selected)?.label ?? '无结果'}</strong></div><div><span className={styles.resultEyebrow}>{result.confidenceKind === 'native-confidence' ? '原生置信度' : '选项集中度'}</span><strong>{percent(result.confidence)}</strong></div></div>
        <p className={styles.note}>题目：{result.question}</p>
        {result.questionType === 'noul' && result.noul !== undefined && <p className={styles.note}>“是”的概率：{percent(result.noul)}</p>}
        {result.questionType === 'score' && result.score !== undefined && <p className={styles.note}>期望分数：{result.score.toFixed(2)} / {result.options.length - 1}</p>}
        <div className={styles.resultOptions}>{result.options.map(option => <div className={styles.resultOption} key={option.id}><div><span>{option.label}</span><strong>{percent(option.probability)}</strong></div><div className={styles.barTrack}><div className={styles.barFill} style={{ width: percent(option.probability) }} /></div></div>)}</div>
        <p className={styles.resultFootnote}>{result.confidenceKind === 'native-confidence' ? '置信度由原生接口返回。' : '集中度由选项概率分布计算，不能表示答对概率。'}模型：{result.model} · 耗时 {result.durationMs} 毫秒</p>
      </div>}
    </div>
  </section>
}
