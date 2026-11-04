/** Synthetic provider barriers and transcript assertions for the real Core integration test. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/**
 * Build a per-test plugin using only the selected Core and private output directory.
 * @param options Built Core root and the test-owned output directory.
 * @returns Cordis plugin containing the synthetic provider and assertions.
 */
export async function createLifecycleFixture({ core, out }) {
  const native = (group, name) => pathToFileURL(path.join(core, 'packages', group, name, 'lib/index.js')).href;
  const { LlmAdapter, LlmError, ToolCallId, createUserMessage } = await import(native('llm', 'llm'));
  const { SessionId } = await import(native('core', 'session'));
  const { defineContentToolFixture } = await import(native('test-support', 'tool-testkit'));

  const name = 'synthetic-smart-selector-lifecycle-qa';
  const inject = ['llm', 'tools', 'agentLoop', 'appReady', 'appExit', 'settings'];

  const gate = () => {
    const value = Promise.withResolvers();
    value.open = false;
    const resolve = value.resolve;
    value.release = () => { value.open = true; resolve(); };
    return value;
  };

  /** Wait on a test barrier without retaining an abort listener after settlement. */
  function wait(gate, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const aborted = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      signal?.addEventListener('abort', aborted, { once: true });
      gate.promise.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    });
  }

  /** A deadline bounds an assertion; the barrier supplies its success condition. */
  async function bounded(task, label) {
    let timer;
    try {
      return await Promise.race([task, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`QA barrier did not settle: ${label}`)), 20000);
      })]);
    } finally { clearTimeout(timer); }
  }

  function apply(ctx) {
    console.log('QA fixture applied');
    const cases = new Map();
    let active;
    const live = [];
    const summary = { syntheticOnly: true, entryMode: 'Core integration', cases: [] };
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = await next();
      if (decision.kind !== 'enter' || String(agent.session.id) !== 'qa-catalog') return decision;
      const entries = [ { name: 'qa-skill-one', description: 'Synthetic relevant skill' }, { name: 'qa-skill-two', description: 'Synthetic unrelated skill' } ];
      const instructions = createUserMessage({ source: { kind: 'agent-instructions', form: 'instructions', baseline: true,
        baselineIdentity: 'qa-lifecycle', changes: [{ action: 'set', scope: 'qa/AGENTS.md', path: 'qa/AGENTS.md', digest: 'synthetic' }] },
        content: [{ type: 'text', text: 'QA_LONG_INSTRUCTION '.repeat(1000) }] });
      const catalog = createUserMessage({ source: { kind: 'skill-catalog', form: 'catalog', entries },
        content: [{ type: 'text', text: '<available_skills>\n- qa-skill-one\n- qa-skill-two\n</available_skills>' }] });
      return { ...decision, messages: [...decision.messages, instructions, catalog] };
    });
    ctx.effect(() => () => {
      fs.writeFileSync(path.join(out, 'fixture-disposed.json'), JSON.stringify({ disposed: true, pid: process.pid }) + '\n');
    });
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (frame.type !== 'chunk') return;
      const state = cases.get(String(agent.session.id));
      if (!state) return;
      live.push({ session: state.id, type: frame.chunk.type, step: state.mainRequests });
      if (state.mainRequests === 2 && frame.chunk.type === 'text-delta' && frame.chunk.text === 'QA_MAIN') {
        state.observedBeforeRelease = !state.mainRelease.open && !state.judgeRelease.open;
        state.firstVisible.release();
      }
    }, { global: true });

    class Adapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model, context: { contextWindow: 128000, maxTokens: 4096 } };
      }
      async *stream(options) {
        console.log('QA adapter ' + options.model);
        const state = active;
        assert(state, 'Only an owned synthetic scenario may request a model');
        if (options.model === 'ordinary-judge') {
          const request = JSON.parse(options.messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n'));
          if (Object.values(request.questions).every(question => question.type === 'noul')) {
            assert.equal(state.id, 'qa-catalog');
            assert(request.state.input.includes('QA_USER_PRIORITY_MARKER'));
            assert(request.state.input.length <= 512);
            assert(request.state.input.includes('QA_LONG_INSTRUCTION'), 'Current-context must retain allowed surrounding instructions within the remaining budget');
            state.catalogInput = request.state.input;
            const text = JSON.stringify({ answers: Object.fromEntries(Object.keys(request.questions).map((id, index) => [id, { type: 'noul', noul: index === 0 ? 1 : 0 }])) });
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text };
            yield { type: 'block-end', index: 0, block: { type: 'text', text } };
            yield { type: 'finish', reason: { kind: 'stop' } };
            return;
          }
          state.judgeStarted.release();
          try { await wait(state.judgeRelease, options.signal); }
          catch (error) { state.judgeAborted = options.signal?.aborted === true; throw error; }
          const text = JSON.stringify({ answers: { 'qa-after': { type: 'choice', choice: 'add', probabilities: { add: 1, none: 0 } } } });
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text };
          yield { type: 'block-end', index: 0, block: { type: 'text', text } };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        assert.equal(options.model, state.model);
        state.mainRequests++;
        if (state.id === 'qa-catalog') {
          const catalog = options.messages.find(message => message.source?.kind === 'skill-catalog');
          assert.deepEqual(catalog.source.entries.map(entry => entry.name), ['qa-skill-one']);
          state.mainSawPrunedCatalog = true;
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: 'QA_CATALOG_DONE' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'QA_CATALOG_DONE' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        if (state.mainRequests === 1) {
          const id = ToolCallId(`tool-${state.id}`);
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: 0, id, name: 'qa_probe', argumentsDelta: '{}' };
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'qa_probe', arguments: '{}' } };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
          return;
        }
        assert.equal(state.mainRequests, 2, 'No unintended retry or extra step');
        state.mainStarted.release();
        yield { type: 'block-start', index: 2, blockType: 'text' };
        yield { type: 'text-delta', index: 2, text: 'QA_MAIN' };
        await wait(state.mainRelease, options.signal);
        if (state.fail) throw new LlmError('Synthetic permanent stream failure', 'BAD_REQUEST', { status: 400 });
        yield { type: 'block-end', index: 2, block: { type: 'text', text: 'QA_MAIN' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }

    ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Adapter()));
    ctx.effect(() => ctx.tools.register(defineContentToolFixture({
      name: 'qa_probe', description: 'Return synthetic fixture content only.', parameters: {},
      async execute() { active.toolExecuted = true; return [{ type: 'text', text: 'QA_TOOL_RESULT' }]; },
    })));

    async function scenario(fail, cancel = false) {
      const state = {
        id: cancel ? 'qa-cancel' : fail ? 'qa-error' : 'qa-normal', model: cancel ? 'main-cancel' : fail ? 'main-error' : 'main-normal', fail,
        mainRequests: 0, mainStarted: gate(), judgeStarted: gate(), firstVisible: gate(),
        mainRelease: gate(), judgeRelease: gate(), judgeAborted: false,
      };
      active = state;
      cases.set(state.id, state);
      const agent = await ctx.agentLoop.create(SessionId(state.id), { provider: 'fixture', model: state.model, cwd: path.join(out, 'workspace') });
      const idle = Promise.withResolvers();
      const disposeIdle = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') idle.resolve();
      }, { global: true });
      try {
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use qa_probe then answer with the synthetic result.' }] }));
        await bounded(Promise.all([state.mainStarted.promise, state.judgeStarted.promise, state.firstVisible.promise]), 'main and judge overlap and first text is visible');
        assert(state.toolExecuted, 'The production loop must execute the actual synthetic tool');
        assert(state.observedBeforeRelease, 'Main text must reach Core while both work gates remain closed');
        if (cancel) agent.cancel({ kind: 'user' });
        else {
          state.mainRelease.release();
          if (!fail) state.judgeRelease.release();
        }
        await bounded(idle.promise, 'agent idle');
        const events = agent.session.snapshotEvents();
        const messages = events.filter(event => event.type === 'assistant/message');
        const attempts = events.filter(event => event.type === 'assistant/attempt');
        assert.equal(events.filter(event => event.type === 'tool/call').length, 1);
        assert.equal(events.filter(event => event.type === 'tool/result').length, 1);
        if (cancel) {
          assert.equal(messages.length, 2, 'Core retains a user-cancelled partial reply as an interrupted message');
          assert.equal(messages.at(-1).data.interrupted, true);
          assert.equal(attempts.length, 0);
          assert(state.judgeAborted, 'User cancellation must cancel the pending auxiliary work');
          assert(!JSON.stringify(messages.at(-1)).includes('QA_REMINDER'));
          assert.equal(events.findLast(event => event.type === 'turn/end').data.reason.kind, 'aborted');
        } else if (fail) {
          assert.equal(messages.length, 1, 'Only the initial tool-call answer may commit as a message');
          assert.equal(attempts.length, 1, 'Partial failed main stream must settle as an attempt');
          assert(state.judgeAborted, 'Main failure must cancel the pending auxiliary work');
          assert(!JSON.stringify(attempts).includes('QA_REMINDER'), 'A failed attempt must not include a success reminder');
        } else {
          assert.equal(messages.length, 2);
          assert.equal(attempts.length, 0);
          assert(JSON.stringify(messages.at(-1)).includes('QA_MAIN'));
          assert(JSON.stringify(messages.at(-1)).includes('QA_REMINDER'));
        }
        return {
          id: state.id, firstTextBeforeEitherGateRelease: state.observedBeforeRelease,
          mainRequests: state.mainRequests, toolCalls: 1, toolResults: 1,
          committedMessages: messages.length, failedAttempts: attempts.length,
          judgeAborted: state.judgeAborted, eventTypes: events.map(event => event.type),
        };
      } finally {
        disposeIdle();
        state.mainRelease.release();
        state.judgeRelease.release();
        if (agent.status !== 'idle') agent.cancel({ kind: 'user' });
      }
    }

    async function catalogScenario() {
      const state = { id: 'qa-catalog', model: 'main-catalog', mainRequests: 0 };
      active = state;
      const agent = await ctx.agentLoop.create(SessionId(state.id), { provider: 'fixture', model: state.model, cwd: path.join(out, 'workspace') });
      const idle = Promise.withResolvers();
      const off = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') idle.resolve(); }, { global: true });
      try {
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'QA_USER_PRIORITY_MARKER choose the relevant synthetic skill.' }] }));
        await bounded(idle.promise, 'catalog input scenario idle');
        assert(state.catalogInput, 'The real candidate must invoke catalog judgement');
        assert(state.mainSawPrunedCatalog, 'The real main-model request must see the selected catalog');
        assert.equal(state.mainRequests, 1);
        const events = agent.session.snapshotEvents();
        assert(events.some(event => event.type === 'user/message' && event.data.source?.kind === 'agent-instructions'));
        assert(events.some(event => event.type === 'assistant/message' && JSON.stringify(event.data).includes('QA_CATALOG_DONE')));
        return { id: state.id, inputCharacters: state.catalogInput.length, budget: 512, userMarkerRetained: true,
          configuredContextRetained: true, mainSawPrunedCatalog: true, mainRequests: state.mainRequests };
      } finally { off(); if (agent.status !== 'idle') agent.cancel({ kind: 'user' }); }
    }

    ctx.effect(() => ctx.appReady.onReady(() => {
      console.log('QA fixture ready');
      console.log('QA effective settings ' + JSON.stringify(ctx.settings.describe().filter(entry => Array.isArray(entry.value?.rules)).map(entry => ({
        ns: entry.ns, enabled: entry.value.enabled, provider: entry.value.provider, model: entry.value.model,
        nativeJev: entry.value.nativeJev, decisionApiEnabled: entry.value.decisionApi?.enabled,
        rules: entry.value.rules.map(rule => ({ id: rule.id, phase: rule.phase, enabled: rule.enabled })),
      }))));
      void (async () => {
        try {
          summary.cases.push(await scenario(false));
          summary.cases.push(await scenario(true));
          summary.cases.push(await scenario(false, true));
          summary.cases.push(await catalogScenario());
          summary.pass = true;
          fs.writeFileSync(path.join(out, 'core-result.json'), JSON.stringify(summary, null, 2) + '\n');
          ctx.appExit(0);
        } catch (error) {
          summary.pass = false;
          summary.error = { name: error.name, message: error.message, stack: error.stack };
          summary.progress = active ? { mainRequests: active.mainRequests, mainStarted: active.mainStarted.open,
            judgeStarted: active.judgeStarted.open, firstVisible: active.firstVisible.open, toolExecuted: active.toolExecuted } : null;
          fs.writeFileSync(path.join(out, 'core-result.json'), JSON.stringify(summary, null, 2) + '\n');
          ctx.appExit(1);
        }
      })();
    }));
  }

    return { name, inject, apply };
}
