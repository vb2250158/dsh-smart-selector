import * as React from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './SmartSelectorSettingsSection.module.css'

export type QuestionType = 'choice' | 'noul' | 'score'
const types: { id: QuestionType; label: string }[] = [
  { id: 'choice', label: '选择题' }, { id: 'noul', label: '判断题' }, { id: 'score', label: '评分题' },
]

/** Select the same question semantics for native and compatibility models. */
export function QuestionTypePicker({ value, disabled = false, onChange }: {
  value: QuestionType; disabled?: boolean; onChange: (value: QuestionType) => void
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const label = types.find(type => type.id === value)?.label
  return <div className={styles.choiceField}><span>题型</span><Menu portal autoFocus open={open && !disabled} selectedId={value} items={types}
    onClose={() => setOpen(false)} onSelect={id => {
      const selected = types.find(type => type.id === id)
      if (selected) onChange(selected.id)
      setOpen(false)
    }} anchor={<Button variant="outline" size="sm" disabled={disabled} aria-label={`题型：${label}`} aria-haspopup="menu" aria-expanded={open && !disabled} onClick={() => setOpen(true)}>{label} ▾</Button>} /></div>
}
