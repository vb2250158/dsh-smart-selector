/** Synthetic registered providers and model boundary for the official catalog lifecycle test. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/**
 * Create an isolated registry-driven scenario without manufacturing skill-catalog messages.
 * @param options Built Core root, private output directory and the initial selector rule.
 * @returns Cordis plugin exercising seven owned follow-up intervals.
 */
export async function createCatalogFixture({ core, out, rule }) {
  const native = (group, name) => pathToFileURL(path.join(core, 'packages', group, name, 'lib/index.js')).href;
  const { LlmAdapter, createUserMessage, createDeveloperMessage } = await import(native('llm', 'llm'));
  const { SessionId } = await import(native('core', 'session'));
  return { name: 'synthetic-official-catalog-qa', inject: ['llm', 'skills', 'agentLoop', 'settings', 'appReady', 'appExit', 'workingDirectory', 'tokenMeter'],
    apply(ctx) {
      const state = { revision: 0, judgeCalls: 0, bodyLoads: 0, mainCalls: 0, providerCalls: 0, controls: [], turns: [] };
      const report = { syntheticOnly: true, actualOfficialCatalogProducer: true, cases: [] };
      const local = [{ name: 'qa-high', score: 0.99 }, { name: 'qa-middle', score: 0.75 }, { name: 'qa-low', score: 0.4 },
        { name: 'qa-boundary', score: 0.5 }, { name: 'qa-zero', score: 0 }];
      const rabi = [{ name: 'qa-rabi-plans', score: 0.96 }, { name: 'qa-rabi-low', score: 0.2 }];
      const definitions = () => [...local, ...rabi, ...(state.revision >= 1 ? [{ name: 'qa-new', score: 0.8 }] : []),
        ...(state.revision >= 2 ? [{ name: 'qa-rabi-new', score: 0.97 }] : [])];
      ctx.effect(() => () => fs.writeFileSync(path.join(out, 'catalog-disposed.json'), JSON.stringify({ providersAborted: state.controls.every(control => control.signal.aborted) })));
      for (const provider of ['qa-local', 'qa-rabi']) ctx.effect(() => ctx.skills.registerProvider(control => {
        state.controls.push(control);
        return { name: provider, async list() {
          state.providerCalls++;
          return definitions().filter(entry => entry.name.includes('rabi') === (provider === 'qa-rabi')).map(entry => ({
            name: entry.name, description: 'Synthetic routing description for ' + entry.name, provider, source: 'custom',
            invocation: { modelInvocable: true, userInvocable: true }, rank: 600, locator: entry.name,
          }));
        }, async get() { state.bodyLoads++; throw new Error('Ordinary inputs must not load skill bodies'); } };
      }));
      class Adapter extends LlmAdapter {
        async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 128000, maxTokens: 4096 } }; }
        async *stream(options) {
          let text = 'Synthetic reply.';
          if (options.model === 'ordinary-judge') {
            state.judgeCalls++;
            const request = JSON.parse(options.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n'));
            const names = Object.keys(request.state.candidates), scores = new Map(definitions().map(entry => [entry.name, entry.score]));
            assert(names.some(name => name.startsWith('qa-rabi-')), 'Registered remote-style skills must reach the official merged catalog');
            assert.equal(names.length, definitions().length);
            text = JSON.stringify({ answers: Object.fromEntries(Object.keys(request.questions).map((id, index) => [id, {
              type: 'noul', noul: state.preserveOfficialOrder ? 1 : scores.get(names[index]),
            }])) });
          } else {
            assert.equal(options.model, 'main');
            state.mainCalls++;
            const catalog = options.messages.findLast(message => message.source?.kind === 'skill-catalog');
            assert(catalog, 'The model must receive an official visible catalog');
            state.visibleNames = catalog.source.entries.map(entry => entry.name);
          }
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text };
          yield { type: 'block-end', index: 0, block: { type: 'text', text } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
      }
      ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Adapter()));
      ctx.effect(() => ctx.appReady.onReady(() => {
        void (async () => {
          let agent;
          try {
            agent = await ctx.agentLoop.create(SessionId('synthetic-catalog'), { provider: 'fixture', model: 'main', cwd: out });
            const publications = () => agent.session.snapshotEvents().filter(event => event.type === 'user/message'
              && event.data.source?.kind === 'skill-catalog' && event.surfaceOp === 'append').length;
            const send = async () => {
              const idle = Promise.withResolvers();
              const off = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') idle.resolve(); }, { global: true });
              let timer;
              try {
                agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue the synthetic session.' }] }));
                await Promise.race([idle.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic follow-up did not settle')), 20000); })]);
                assert.equal(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'completed');
              } finally { clearTimeout(timer); off(); }
              return { judgeCalls: state.judgeCalls, publications: publications(), selected: [...state.visibleNames] };
            };
            const first = await send();
            assert.equal(first.judgeCalls, 1);
            assert.equal(first.selected.length, 3, 'score-above50 keeps every qualifying skill, not a top-N replacement');
            assert(first.selected.includes('qa-rabi-plans'));
            assert(!first.selected.includes('qa-boundary'), 'score-above50 excludes a candidate at exactly 50 percent');
            report.cases.push({ id: 'registry-official-selector', ...first });
            const repeated = await send();
            assert.equal(repeated.judgeCalls, first.judgeCalls, 'Identical official raw catalog must not cause another judgement');
            assert.equal(repeated.publications, first.publications);
            report.cases.push({ id: 'same-raw-no-rejudge', ...repeated });
            state.revision = 1; state.controls.forEach(control => control.invalidate());
            const changed = await send();
            assert.equal(changed.judgeCalls, first.judgeCalls + 1);
            assert.equal(changed.selected.length, 4);
            report.cases.push({ id: 'raw-change-rejudges', ...changed });
            // Equal scores keep the official order, so all entries match its digest exactly.
            state.preserveOfficialOrder = true;
            await ctx.settings.update('candidate-smart-selector', { rules: [{ ...rule, selectionValue: '0' }] });
            await ctx.root.loader.await();
            const all = await send();
            assert.equal(all.judgeCalls, changed.judgeCalls + 1);
            assert.equal(all.selected.length, definitions().length);
            report.cases.push({ id: 'config-change-with-pending', ...all });
            await ctx.settings.update('candidate-smart-selector', { rules: [{ ...rule, selectionValue: '90' }] });
            await ctx.root.loader.await();
            const absent = await send();
            assert.equal(absent.judgeCalls, all.judgeCalls, 'Config changes must not invent a catalog when the official producer has no update');
            assert.equal(absent.publications, all.publications);
            report.cases.push({ id: 'no-official-pending-no-judge', ...absent });
            state.preserveOfficialOrder = false;
            state.revision = 2; state.controls.forEach(control => control.invalidate());
            const configured = await send();
            assert.equal(configured.judgeCalls, absent.judgeCalls + 1);
            assert.equal(configured.selected.length, 3, 'The changed configuration takes effect on the next genuine official update');
            report.cases.push({ id: 'next-official-update-uses-config', ...configured });
            const visibleCatalog = [...agent.session.surface.nodes].reverse().map(seq => ({ seq, event: agent.session.eventAt(seq) }))
              .find(({ event }) => event.type === 'user/message' && event.data.source.kind === 'skill-catalog');
            const seq = visibleCatalog.seq;
            agent.session.append('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq],
              shadowedTokenCount: ctx.tokenMeter.estimateMessage(visibleCatalog.event.data) });
            agent.session.append('developer/message', { turn: 6, step: 1, message: createDeveloperMessage({ source: { kind: 'plugin:dsh-smart-selector' }, content: [] }) },
              { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
            assert(!agent.session.surface.nodes.includes(seq));
            const restored = await send();
            assert.equal(restored.judgeCalls, configured.judgeCalls + 1, 'An invisible old receipt cannot suppress official republication');
            assert.equal(restored.publications, configured.publications + 1);
            report.cases.push({ id: 'core-prune-restores-catalog', ...restored });
            assert.equal(state.bodyLoads, 0);
            report.pass = true;
          } catch (error) { report.pass = false; report.error = { name: error.name, message: error.message, stack: error.stack }; }
          finally {
            if (agent && agent.status !== 'idle') agent.cancel({ kind: 'user' });
            report.judgeCalls = state.judgeCalls; report.mainCalls = state.mainCalls; report.providerCalls = state.providerCalls; report.bodyLoads = state.bodyLoads;
            fs.writeFileSync(path.join(out, 'catalog-result.json'), JSON.stringify(report));
            ctx.appExit(report.pass ? 0 : 1);
          }
        })();
      }));
    } };
}
