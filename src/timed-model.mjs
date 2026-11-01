import { createDecisionClient } from './decisions.mjs';

/** Attach operation labels through the optional statistics plugin without changing model options. */
export function createTimedModelStream(ctx) {
  const stream = (options, operation) => {
    const timing = ctx.get('chatStageTiming');
    return timing === undefined ? ctx.llm.stream(options)
      : timing.stream({ plugin: 'dsh-smart-selector', ...operation }, () => ctx.llm.stream(options));
  };
  stream.decide = createDecisionClient(ctx);
  return stream;
}
