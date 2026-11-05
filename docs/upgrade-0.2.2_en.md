# Upgrade to 0.2.2

The plugin now requires the official `sessionProjections` service for its latest catalog proof. Standard profiles already include it. Custom compositions must load `dsh-session-projection`; a missing dependency fails activation rather than falling back to synchronous history scans. Managed installation resolves package dependencies without changing session data.

New configurations contain only Skill trimming, with a normalized score strictly above 50/100 and no result-count cap. A score of exactly 50 is excluded. Top-N, bottom-N and other score modes remain configurable. Model scores do not become calibrated probabilities.

Existing explicit `rules` arrays, empty arrays and custom settings are not overwritten. To adopt the new setup, retain the desired rules in plugin settings, select the score-above mode, enter 50, and save. Opening settings no longer adds group presets. Other rule types and actions remain available for explicit configuration.

Selection follows the official catalog publication lifecycle. The official skill registry collects all providers, including Rabi, before this plugin prunes the pending catalog's names and summaries. New user input alone does not rescore it. Catalog changes or compaction that removes the visible catalog permit selection on the next official publication. A matching catalog that remains visible can be reused.

Published catalog messages add `source['dsh-smart-selector:catalog']` metadata containing only a version and fingerprints. `source.entries` still records exactly the published items. Older sessions without this metadata perform ordinary selection on their next official catalog publication. Existing events are not rewritten and require no manual migration. Mixed catalog chains that inject extra content retain their original execution path.

Configuration changes are checked only when the official producer supplies a pending catalog. If a previous selection retained the full catalog, or selection was disabled when the full catalog was published, there may be no new pending catalog. In that case changes apply on the next actual official trigger; the selector does not inject another catalog or synthesize an event.
