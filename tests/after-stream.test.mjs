import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { createAfterStream } from '../src/after-stream.mjs';

const expectedStreams = JSON.parse(readFileSync(new URL('./expected/after-stream.json', import.meta.url), 'utf8'));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(setImmediate);
const text = value => ({ type: 'text-delta', index: 0, text: value });
const finish = { type: 'finish', reason: { kind: 'stop' } };
const from = async function* (chunks) { yield* chunks; };
const untilAborted = signal => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  if (signal.aborted) reject(signal.reason);
});

test('factories stay lazy, including returning an unconsumed iterator', async () => {
  let calls = 0;
  const stream = createAfterStream({
    createUpstream: () => { calls++; return from([]); },
    judge: () => { calls++; return ''; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(await stream.return('unused'), { done: true, value: 'unused' });
  assert.equal(calls, 0);
});

test('first text precedes both the upstream tail and the judgement result', async () => {
  const tail = deferred(), judgement = deferred(), judgeStarted = deferred();
  const early = text('early');
  const stream = createAfterStream({
    createUpstream: async function* () { yield early; await tail.promise; yield finish; },
    judge: () => { judgeStarted.resolve(); return judgement.promise; },
  });
  const first = await stream.next();
  assert.equal(first.value, early);
  await judgeStarted.promise;
  let settled = false;
  const next = stream.next().then(value => { settled = true; return value; });
  await turn();
  assert.equal(settled, false);
  tail.resolve();
  await turn();
  assert.equal(settled, false);
  judgement.resolve('');
  assert.equal((await next).value, finish);
  assert.equal((await stream.next()).done, true);
});

test('recorded answer preserves the original blocks, reminder order, indexes and finish reason', async () => {
  const chunks = [
    { type: 'block-start', index: 4, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 4, text: 'reason' },
    { type: 'block-end', index: 4, block: { type: 'reasoning', text: 'reason' } },
    { type: 'block-start', index: 9, blockType: 'text' },
    { type: 'text-delta', index: 9, text: 'answer' },
    { type: 'block-end', index: 9, block: { type: 'text', text: 'answer' } },
    { type: 'usage', usage: { outputTokens: 1 } },
    finish,
  ];
  const result = await Array.fromAsync(createAfterStream({
    createUpstream: () => from(chunks), judge: async () => 'reminder',
  }));
  assert.deepEqual(result, expectedStreams.completed);
  assert.equal(result.at(-1).reason, finish.reason);
});

test('empty reminder preserves the original chunk identities and finish reason', async () => {
  const terminal = { type: 'finish', reason: { kind: 'max-tokens' } };
  const chunks = [text('partial'), terminal];
  const result = await Array.fromAsync(createAfterStream({ createUpstream: () => from(chunks), judge: async () => '' }));
  assert.equal(result[0], chunks[0]);
  assert.equal(result[1], terminal);
});

for (const kind of ['error', 'aborted']) {
  test(`structured ${kind} finish cancels pending judgement and preserves the original terminal outcome`, async () => {
    const failure = { type: 'finish', reason: { kind, failure: { code: 'FIXTURE', message: 'provider failure' } } };
    let ownedSignal, returned = 0;
    const warnings = [];
    const original = from([text('partial'), failure]);
    const originalReturn = original.return.bind(original);
    original.return = async (...args) => { returned++; return originalReturn(...args); };
    const stream = createAfterStream({
      createUpstream: () => original,
      judge: signal => { ownedSignal = signal; return untilAborted(signal); },
      onJudgementError: error => warnings.push(error),
    });
    assert.deepEqual((await stream.next()).value, text('partial'));
    assert.equal((await stream.next()).value, failure);
    assert.equal(ownedSignal.aborted, true);
    assert.equal((await stream.next()).done, true);
    assert.equal(returned, 1);
    assert.deepEqual(warnings, []);
  });

  test(`structured ${kind} finish never appends an already resolved reminder`, async () => {
    const failure = { type: 'finish', reason: { kind, failure: { code: 'FIXTURE', message: 'provider failure' } } };
    const result = await Array.fromAsync(createAfterStream({
      createUpstream: () => from([text('partial'), failure]), judge: async () => 'must not appear',
    }));
    assert.deepEqual(result, expectedStreams.failures[kind]);
    assert.equal(result.at(-1), failure);
  });

  test(`cleanup rejection cannot replace structured ${kind} finish`, async () => {
    const failure = { type: 'finish', reason: { kind, failure: { code: 'FIXTURE', message: 'provider failure' } } };
    const stream = createAfterStream({
      createUpstream: () => ({
        next: async () => ({ done: false, value: failure }),
        return: async () => { throw new Error('cleanup failed'); },
        [Symbol.asyncIterator]() { return this; },
      }),
      judge: signal => untilAborted(signal),
    });
    assert.equal((await stream.next()).value, failure);
    assert.equal((await stream.next()).done, true);
  });
}

test('end without finish neither appends a reminder nor fabricates success', async () => {
  const chunks = [text('partial')];
  const result = await Array.fromAsync(createAfterStream({ createUpstream: () => from(chunks), judge: async () => 'unused reminder' }));
  assert.deepEqual(result, chunks);
});

test('end without finish cancels and settles unfinished judgement', async () => {
  let judgementSignal;
  const result = await Array.fromAsync(createAfterStream({
    createUpstream: () => from([text('partial')]),
    judge: signal => { judgementSignal = signal; return untilAborted(signal); },
  }));
  assert.deepEqual(result, [text('partial')]);
  assert.equal(judgementSignal.aborted, true);
});

for (const phase of ['before tail', 'after tail']) {
  test(`ordinary judgement failure ${phase} preserves original output`, async () => {
    const gate = deferred(), tail = deferred();
    const error = new Error('judge failed'), errors = [];
    const stream = createAfterStream({
      createUpstream: async function* () { yield text('answer'); await tail.promise; yield finish; },
      judge: () => gate.promise,
      onJudgementError: error => errors.push(error),
    });
    assert.deepEqual((await stream.next()).value, text('answer'));
    if (phase === 'before tail') { gate.reject(error); await turn(); tail.resolve(); }
    else { tail.resolve(); await turn(); gate.reject(error); }
    const rest = await Array.fromAsync(stream);
    assert.deepEqual(rest, [finish]);
    assert.deepEqual(errors, [error]);
  });
}

test('an already aborted parent starts neither source nor judgement', async () => {
  const parent = new AbortController(), reason = new Error('cancelled');
  parent.abort(reason);
  let calls = 0;
  const stream = createAfterStream({
    signal: parent.signal,
    createUpstream: () => { calls++; return from([]); },
    judge: async () => { calls++; return ''; },
  });
  await assert.rejects(stream.next(), error => error === reason);
  assert.equal(calls, 0);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('parent cancellation during judgement emits no reminder or finish', async () => {
  const parent = new AbortController(), reason = new Error('cancelled');
  let ownedSignal, returned = 0;
  const upstream = from([text('partial'), finish]);
  const originalReturn = upstream.return.bind(upstream);
  upstream.return = async (...args) => { returned++; return originalReturn(...args); };
  const stream = createAfterStream({
    signal: parent.signal, createUpstream: () => upstream,
    judge: signal => { ownedSignal = signal; return untilAborted(signal); },
  });
  assert.deepEqual((await stream.next()).value, text('partial'));
  const waiting = stream.next();
  parent.abort(reason);
  await assert.rejects(waiting, error => error === reason);
  assert.equal(ownedSignal.aborted, true);
  assert.equal(returned, 1);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('return cancels judgement immediately and closes a cooperative pending upstream', async () => {
  const nextStarted = deferred(), nextResult = deferred();
  let ownedSignal, returned = 0;
  const stream = createAfterStream({
    createUpstream: () => ({
      next() { nextStarted.resolve(); return nextResult.promise; },
      return() { returned++; nextResult.resolve({ done: true }); return Promise.resolve({ done: true }); },
      [Symbol.asyncIterator]() { return this; },
    }),
    judge: signal => { ownedSignal = signal; return untilAborted(signal); },
  });
  const waiting = stream.next();
  const rejected = assert.rejects(waiting, error => error.name === 'AbortError');
  await nextStarted.promise;
  const closing = stream.return('closed');
  assert.equal(ownedSignal.aborted, true);
  assert.equal(returned, 1);
  assert.deepEqual(await closing, { done: true, value: 'closed' });
  await rejected;
});

test('throw cancels judgement and keeps the caller error', async () => {
  const reason = new Error('consumer failure');
  let ownedSignal;
  const stream = createAfterStream({
    createUpstream: () => from([text('partial'), finish]),
    judge: signal => { ownedSignal = signal; return untilAborted(signal); },
  });
  await stream.next();
  await assert.rejects(stream.throw(reason), error => error === reason);
  assert.equal(ownedSignal.aborted, true);
});

test('parent cancellation also stops a pending source that follows the original Core signal', async () => {
  const parent = new AbortController(), reason = new Error('Core cancelled');
  const started = deferred();
  let sourceClosed = false, ownedSignal;
  const stream = createAfterStream({
    signal: parent.signal,
    createUpstream: async function* () {
      try { started.resolve(); await untilAborted(parent.signal); }
      finally { sourceClosed = true; }
    },
    judge: signal => { ownedSignal = signal; return untilAborted(signal); },
  });
  const waiting = stream.next();
  const rejected = assert.rejects(waiting, error => error === reason);
  await started.promise;
  parent.abort(reason);
  await rejected;
  assert.equal(sourceClosed, true);
  assert.equal(ownedSignal.aborted, true);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('return during the finish wait cancels judgement before queued generator cleanup', async () => {
  const judgeStarted = deferred();
  let ownedSignal, returned = 0;
  const original = from([text('partial'), finish]);
  const originalReturn = original.return.bind(original);
  original.return = async (...args) => { returned++; return originalReturn(...args); };
  const stream = createAfterStream({
    createUpstream: () => original,
    judge: signal => { ownedSignal = signal; judgeStarted.resolve(); return untilAborted(signal); },
  });
  await stream.next();
  await judgeStarted.promise;
  const waiting = stream.next();
  const rejected = assert.rejects(waiting, error => error.name === 'AbortError');
  const closing = stream.return();
  assert.equal(ownedSignal.aborted, true);
  assert.equal(returned, 1);
  await Promise.all([closing, rejected]);
});

test('successful consumption removes its parent cancellation listener', async () => {
  const parent = new AbortController();
  let ownedSignal;
  const result = await Array.fromAsync(createAfterStream({
    signal: parent.signal,
    createUpstream: () => from([text('answer'), finish]),
    judge: async signal => { ownedSignal = signal; return ''; },
  }));
  assert.deepEqual(result, [text('answer'), finish]);
  assert.equal(ownedSignal.aborted, true);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('upstream failure after partial text is never downgraded by judgement failure', async () => {
  const mainError = new Error('main failed');
  let ownedSignal;
  const stream = createAfterStream({
    createUpstream: async function* () { yield text('partial'); throw mainError; },
    judge: signal => { ownedSignal = signal; return Promise.reject(new Error('judge failed')); },
  });
  assert.deepEqual((await stream.next()).value, text('partial'));
  await assert.rejects(stream.next(), error => error === mainError);
  assert.equal(ownedSignal.aborted, true);
});

test('return failure remains visible after all other resources have settled', async () => {
  const closeError = new Error('return failed');
  const parent = new AbortController();
  let ownedSignal;
  const stream = createAfterStream({
    signal: parent.signal,
    createUpstream: () => ({
      next: async () => ({ done: false, value: text('partial') }),
      return: async () => { throw closeError; },
      [Symbol.asyncIterator]() { return this; },
    }),
    judge: signal => { ownedSignal = signal; return untilAborted(signal); },
  });
  await stream.next();
  await assert.rejects(stream.return(), error => error === closeError);
  assert.equal(ownedSignal.aborted, true);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('cleanup failure cannot replace the original main-stream failure', async () => {
  const mainError = new Error('main failed'), closeError = new Error('return failed');
  const stream = createAfterStream({
    createUpstream: () => ({
      next: async () => { throw mainError; },
      return: async () => { throw closeError; },
      [Symbol.asyncIterator]() { return this; },
    }),
    judge: signal => untilAborted(signal),
  });
  await assert.rejects(stream.next(), error => error === mainError);
});
