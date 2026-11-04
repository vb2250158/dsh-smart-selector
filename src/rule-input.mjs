/** Read exactly the user-selected text source from the model-visible pre-step messages. */
export function beforeInput(rule, messages, skillSummaries = []) {
  if (rule.input === 'custom-text') return rule.customInput;
  const latest = messages.findLast(message => message.source.kind === 'user');
  if (rule.input === 'user-message-with-skills') {
    if (!latest) return '';
    const userMessage = latest.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (!userMessage.trim()) return '';
    const names = new Set(rule.options.filter(option => option.action.type === 'inject-skill').map(option => option.action.text));
    const skills = skillSummaries.filter(skill => names.has(skill.name) && skill.invocation.modelInvocable)
      .map(skill => ({ name: skill.name, description: skill.description.slice(0, 500) }));
    return skills.length ? JSON.stringify({ userMessage, skills }) : '';
  }
  const rows = rule.input === 'latest-user-message' ? (latest ? [latest] : []) : messages;
  return rows.flatMap(row => row.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
}

/** Prepare the configured input for one Jev-managed skill before its body is injected. */
export function skillInput(rule, skill, messages) {
  if (rule.input === 'custom-text') return rule.customInput;
  if (rule.input === 'skill-content') return JSON.stringify({ name: skill.name, content: skill.content });
  const latest = messages.findLast(message => message.source?.kind === 'user');
  const userMessage = latest?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
  if (rule.input === 'skill-summary') return JSON.stringify({ userMessage, skill: { name: skill.name, description: skill.description } });
  if (rule.input === 'latest-user-message') return userMessage;
  if (rule.input === 'current-context-text') return messages.flatMap(row => row.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
  return '';
}

/**
 * Read current-turn tool results, preferring the latest canonical tool-role message for each call.
 * @param messages Model-visible messages, including direct tool messages or nested result blocks.
 * @returns Tool facts with recorded status and text; canonical messages replace nested copies of their call.
 */
export function toolFacts(messages) {
  const lastUser = messages.findLastIndex(message => message.source?.kind === 'user');
  const currentTurn = lastUser < 0 ? messages : messages.slice(lastUser + 1);
  const canonical = new Map();
  for (let index = 0; index < currentTurn.length; index += 1) {
    const message = currentTurn[index];
    if (message.role === 'tool') canonical.set(message.toolCallId, index);
  }
  return currentTurn.flatMap((message, index) => {
    if (message.role === 'tool') {
      if (canonical.get(message.toolCallId) !== index) return [];
      return [{
        id: message.toolCallId, failed: message.isError === true,
        text: message.content.filter(item => item.type === 'text').map(item => item.text).join('\n'),
      }];
    }
    return message.content.filter(block => block.type === 'tool-result' && !canonical.has(block.toolCallId)).map(block => ({
      id: block.toolCallId, failed: block.isError === true,
      text: block.content.filter(item => item.type === 'text').map(item => item.text).join('\n'),
    }));
  });
}

/** A custom value is literal; otherwise the actual tool records become the judgement input. */
export function afterInput(rule, facts) {
  return rule.input === 'custom-text' ? rule.customInput : JSON.stringify(facts);
}
