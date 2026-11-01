# Upgrade to Smart Selector 0.2.0

Home or command-line overlays may reject configuration edits. Rejected writes display an unsaved error and retain the draft. Update the overriding configuration before saving; rejection never counts as a successful save.

## Change

The repository and package move from `dsh-jev-context-gate` to [`dsh-smart-selector`](https://github.com/vb2250158/dsh-smart-selector). The UI title becomes Smart selector. Existing versions remain available from the old repository; subsequent releases use the new repository.

The configuration entry ID remains `dsh-jev-context-gate`, retaining rules, enabled state, decision and text models, and context policy. Persisted session events, skill-source identities and the legacy settings namespace remain unchanged. Do not rewrite session logs.

New extensions use `ctx.smartSelector`; `ctx.jev` delegates to the same service. New clients use `/api/dsh-smart-selector/`; legacy HTTP paths share the same handlers. JEV and GPT continue to name specific models or protocols.

Native decisions retain the 0.1.45 connection behavior: use the provider profile and credential reference configured in Settings → Models. The retired `decisionApi.apiKeyRef` no longer selects a connection. Existing keys are neither copied nor removed.

## Migration

1. Back up the profile manifests, lockfile and `cordis.patch.yml`. Test a fixed 40-character Git commit in an independent Home.
2. Replace the old package in the plugin sync manifest. Update `environment.json` bundles and dependencies, retaining `dsh-jev-context-gate` in `settingsNamespaces`.
3. Keep `id: dsh-jev-context-gate` in the profile patch, changing only its `name` to `dsh-smart-selector`. Preserve the complete configuration and entry metadata.
4. Install the replacement and remove the old package through the synchronizer or official DSH plugin CLI, as one deployment transaction. Never load both. Use managed shutdown, backup, frozen installation and recovery when a restart is required.
5. Confirm the old package and bundle are absent, the new package is loaded, and the Smart selector page retains all settings. Run the affected functional checks.

Event and action registrations allow additional selection scenarios. Event providers own real inputs and apply returned selections. New channels, external actions and paid requests retain their own configuration and authorization requirements.
