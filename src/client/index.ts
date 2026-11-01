import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelPickerService } from 'dsh-codex-model-selector/model-picker'
import { SmartSelectorSettingsSection, type ModelPickerSource, type Settings } from './SmartSelectorSettingsSection.tsx'
import { createSettingsForm } from './settings-form.mjs'
import { CONFIG_ENTRY_ID } from '../identity.mjs'

export const inject = ['slots', 'configForms', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  // Rule migration callbacks are executable code and cannot cross the JSON settings transport.
  const scope = createSettingsForm(ctx.configForms.get<Settings>(CONFIG_ENTRY_ID), ctx.configForms.describe())
  const loadCatalog = async (): Promise<ModelCatalog> => {
    const response = await ctx.remote.session.modelCatalog()
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
    return response.value
  }
  let Picker: ModelPickerService['CatalogPicker'] | undefined
  const listeners = new Set<() => void>()
  const modelPicker: ModelPickerSource = {
    getSnapshot: () => Picker,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.inject(['modelPickers'], child => {
    child.effect(() => {
      Picker = child.modelPickers.CatalogPicker
      for (const listener of listeners) listener()
      return () => { Picker = undefined; for (const listener of listeners) listener() }
    })
  })
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-smart-selector',
    inject: () => ({ scope, loadCatalog, modelPicker }),
  }, SmartSelectorSettingsSection))
}
