import { isNativeSelection } from './mode.mjs';
import { resolveDecisionConnection } from './provider-connection.mjs';

/** OpenRouter's native typed-decision transport; secrets are resolved on each call. */
export function createDecisionClient(ctx, fetchImpl = fetch) {
  return ({ settings, state, questions, signal }, operation = {}) => {
    const timed = (phase, task) => {
      const timing = ctx.get?.('chatStageTiming');
      return timing?.run?.({ plugin: 'dsh-smart-selector', operation: phase }, task) ?? task();
    };
    const task = async () => {
      const config = settings.decisionApi;
      if (!isNativeSelection(settings)) throw new Error('Select an OpenRouter native decision model');
      const connection = await timed('decision-credentials', () => resolveDecisionConnection(ctx, settings.provider));
      const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs);
      combined.throwIfAborted();
      const response = await timed('decision-response-headers', () => fetchImpl(connection.endpoint, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model, state, questions }),
      }));
      // Provider error bodies can contain request data; expose only the HTTP status.
      if (!response.ok) throw new Error(`OpenRouter Decisions HTTP ${response.status}`);
      let result;
      try { result = await timed('decision-response-body', () => response.json()); }
      catch (invalidJson) { throw new Error('Invalid decision JSON response'); }
      combined.throwIfAborted();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid decision response');
      await timed('decision-validation', () => validateAnswers(questions, result.answers));
      if (typeof result.model !== 'string' || !result.model) throw new Error('Missing decision response model');
      return result;
    };
    const timing = ctx.get?.('chatStageTiming');
    return timing?.request?.({ plugin: 'dsh-smart-selector', ...operation, provider: settings.provider, model: settings.model,
      transport: 'native-decisions' }, task) ?? task();
  };
}

/** Reject incomplete, refused, or malformed wire answers before any rule action. */
export function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)
    || Object.keys(questions).length !== Object.keys(answers).length) throw new Error('Invalid decision answers');
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer || answer.type !== question.type) throw new Error('Missing or refused decision answer');
    if (question.type === 'noul') {
      if (!probability(answer.noul)) throw new Error('Invalid decision probability');
    } else if (question.type === 'choice') {
      const ids = Object.keys(question.criteria);
      const probabilities = answer.probabilities;
      if (probabilities === undefined) throw new Error('Decision response omitted probabilities required by rule thresholds; select a model that returns probabilities.');
      if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)
        || Object.keys(probabilities).length !== ids.length || !ids.includes(answer.choice)
        || (answer.confidence !== undefined && !probability(answer.confidence))
        || ids.some(key => !Object.hasOwn(probabilities, key) || !probability(probabilities[key]))
        || Math.abs(ids.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 0.02) throw new Error('Invalid decision choice');
    } else if (question.type === 'score') {
      const ids = question.criteria.map((_, index) => String(index));
      const probabilities = answer.probabilities;
      if (probabilities === undefined) throw new Error('Decision response omitted probabilities required by rule thresholds; select a model that returns probabilities.');
      if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)
        || Object.keys(probabilities).length !== ids.length || (answer.confidence !== undefined && !probability(answer.confidence))
        || ids.some(id => !probability(probabilities[id]))
        || Math.abs(ids.reduce((sum, id) => sum + probabilities[id], 0) - 1) > 0.02
        || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > ids.length - 1
        || Math.abs(ids.reduce((sum, id) => sum + Number(id) * probabilities[id], 0) - answer.score) > 0.02) throw new Error('Invalid decision score');
    } else throw new Error('Unsupported decision question type');
  }
}

const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
