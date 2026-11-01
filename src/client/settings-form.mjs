import { SettingsSchema } from '../settings.mjs';
import { CONFIG_ENTRY_ID } from '../identity.mjs';

/** Decode rule transforms locally while retaining DSH's ordered, revision-fenced writes.
 * @param form Shared DSH form for the plugin entry.
 * @param mirror Shared Host settings mirror.
 * @returns Rule settings form with the plugin's complete validation.
 */
export function createSettingsForm(form, mirror) {
  let previousForm, previousMirror, snapshot;
  return {
    getSnapshot() {
      const base = form.getSnapshot();
      const document = mirror.getSnapshot();
      if (base === previousForm && document === previousMirror) return snapshot;
      previousForm = base;
      previousMirror = document;
      snapshot = { ...base };
      if (base.mode === 'memory') return snapshot;
      const view = document.view?.namespaces.find(entry => entry.ns === CONFIG_ENTRY_ID);
      if (!view || view.value === undefined) return snapshot;
      try {
        snapshot.value = SettingsSchema(view.value);
        snapshot.status = 'ready';
      } catch (invalidRuleSettings) {
        // A malformed Host section must not become editable or reach model requests.
        snapshot.value = undefined;
        snapshot.status = 'unavailable';
      }
      return snapshot;
    },
    subscribe(listener) {
      const offForm = form.subscribe(listener);
      const offMirror = mirror.subscribe(listener);
      return () => { offForm(); offMirror(); };
    },
    mutate: (ops, revision) => form.mutate(ops, revision),
    set: (field, value) => form.set(field, value),
    unset: field => form.unset(field),
  };
}
