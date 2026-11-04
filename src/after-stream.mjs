/** Race one owned wait against cancellation while observing a late rejection. */
function waitForOperation(operation, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    Promise.resolve(operation).then(value => finish(resolve, value), error => finish(reject, error));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/**
 * Stream the original answer while judging independent tool facts in parallel.
 * @param options.createUpstream Factory for the original stream; called on first consumption.
 * @param options.judge Resolves an optional reminder string and honors its owned AbortSignal.
 * @param options.signal Original Core cancellation signal, also owning the upstream transport.
 * @param options.onJudgementError Reports an ordinary judgement failure without changing the answer.
 * @returns A lazy iterator retaining only the current chunk, highest block index and judgement outcome.
 * Consumer return/throw immediately cancels judgement and requests upstream return. It cannot
 * force an uncooperative upstream to stop: Core's original signal and transport timeout still
 * own that work. Cleanup awaits the original iterator and the cancelled judgement, so both
 * must settle under their existing cancellation/timeout contracts.
 */
export function createAfterStream({ createUpstream, judge, signal, onJudgementError }) {
  const controller = new AbortController();
  const ownedSignal = controller.signal;
  let upstream;
  let upstreamDone = false;
  let closePromise;

  const cancel = reason => {
    if (!ownedSignal.aborted) controller.abort(reason);
  };
  const closeUpstream = () => {
    if (upstream === undefined || upstreamDone || closePromise !== undefined) return closePromise;
    try { closePromise = Promise.resolve(upstream.return?.()); }
    catch (error) { closePromise = Promise.reject(error); }
    // A consumer can request closure before the generator reaches finally.
    // Attach the observer immediately; finally remains the owner of its result.
    closePromise.catch(_error => { /* finally observes and reports this same result. */ });
    return closePromise;
  };

  async function* run() {
    let judgement;
    let maximumIndex = -1;
    let judgementApplied = false;
    let failed = false;
    const parentAborted = () => cancel(signal.reason);
    signal?.addEventListener('abort', parentAborted, { once: true });
    if (signal?.aborted) parentAborted();
    try {
      ownedSignal.throwIfAborted();
      upstream = createUpstream()[Symbol.asyncIterator]();
      judgement = Promise.resolve().then(() => {
        ownedSignal.throwIfAborted();
        return judge(ownedSignal);
      }).then(context => ({ ok: true, context }), error => ({ ok: false, error }));

      while (true) {
        ownedSignal.throwIfAborted();
        const item = await waitForOperation(upstream.next(), ownedSignal);
        ownedSignal.throwIfAborted();
        if (item.done) { upstreamDone = true; return; }
        const chunk = item.value;
        if ('index' in chunk) maximumIndex = Math.max(maximumIndex, chunk.index);
        if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          // Adapters report failures as terminal chunks rather than thrown errors.
          // The original terminal outcome takes priority over judgement and cleanup.
          failed = true;
          cancel(new DOMException('Main stream finished unsuccessfully', 'AbortError'));
          yield chunk;
          return;
        }
        if (chunk.type === 'finish' && !judgementApplied) {
          const result = await waitForOperation(judgement, ownedSignal);
          ownedSignal.throwIfAborted();
          judgementApplied = true;
          if (result.ok && result.context) {
            const index = ++maximumIndex;
            yield { type: 'block-start', index, blockType: 'text' };
            ownedSignal.throwIfAborted();
            yield { type: 'text-delta', index, text: result.context };
            ownedSignal.throwIfAborted();
            yield { type: 'block-end', index, block: { type: 'text', text: result.context } };
          } else if (!result.ok) {
            onJudgementError?.(result.error);
          }
          ownedSignal.throwIfAborted();
        }
        yield chunk;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      cancel(new DOMException('After-stream consumer closed', 'AbortError'));
      const closing = closeUpstream();
      const settled = await Promise.allSettled([closing, judgement]);
      signal?.removeEventListener('abort', parentAborted);
      // Cleanup failure must remain visible, but cannot replace the original stream failure.
      if (!failed && settled[0].status === 'rejected') throw settled[0].reason;
    }
  }

  const iterator = run();
  return {
    next(value) { return iterator.next(value); },
    return(value) {
      cancel(new DOMException('After-stream consumer returned', 'AbortError'));
      closeUpstream();
      return iterator.return(value);
    },
    throw(error) {
      cancel(error);
      closeUpstream();
      return iterator.throw(error);
    },
    [Symbol.asyncIterator]() { return this; },
  };
}
