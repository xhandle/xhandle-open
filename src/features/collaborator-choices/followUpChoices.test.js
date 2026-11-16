import { normalizeFollowUpChoices, attachFollowUpChoices, choiceOptions, latestChoiceEntry, matchFollowUpOption,
  followUpAnswerContext, followUpHistoryContent, hideChoicePayload, SOMETHING_ELSE } from './followUpChoices';

const choices = { question: 'Which view would you prefer?', options: [{ label: 'Table', description: 'Compare rows.' }, { label: 'Document' }] };

test('structured choices have app-owned identities, a custom escape and no executable metadata', () => {
  const prompt = normalizeFollowUpChoices(choices);
  expect(prompt).toMatchObject({ type: 'follow-up', completed: false, options: [{ value: 'option-1', label: 'Table' }, { value: 'option-2', label: 'Document' }] });
  expect(choiceOptions(prompt).at(-1)).toMatchObject({ value: SOMETHING_ELSE, label: 'Something else', custom: true });
  const message = attachFollowUpChoices({ role: 'assistant', content: choices.question }, choices);
  expect(message.choicePrompt.id).toBeTruthy();
  expect(attachFollowUpChoices(message)).toBe(message);
  expect(message.workspaceActionPlan).toBeUndefined();
});

test.each([
  { ...choices, options: ['Only one'] },
  { ...choices, options: Array(9).fill('Choice') },
  { ...choices, options: ['Table', 'table'] },
  { ...choices, options: ['Table', 'Something else'] },
  { ...choices, options: [{ label: 'Apply', operation: 'delete' }, 'Cancel'] },
  { ...choices, options: [{ label: 'Table', value: 'execute' }, 'Document'] },
  { ...choices, question: '' },
  { ...choices, options: ['x'.repeat(181), 'Document'] },
  { ...choices, target: { id: 'other-document' } },
])('rejects invalid or executable choice data %#', value => expect(() => normalizeFollowUpChoices(value)).toThrow());

test('old numbered follow-up questions become controls while facts, code, and recommendations stay unchanged', () => {
  const message = attachFollowUpChoices({ role: 'assistant', content: 'Which document should I inspect?\n\n1. **Safety Requirements** — The current draft.\n2. **Concept of Operations** — Operational intent.' });
  expect(message.content).toBe('Which document should I inspect?');
  expect(message.choicePrompt.options[0]).toMatchObject({ label: 'Safety Requirements', description: 'The current draft.' });
  expect(attachFollowUpChoices({ role: 'assistant', content: 'Would you prefer a table or a document?' }).choicePrompt.options).toHaveLength(2);
  for (const content of ['The system has these options:\n1. Table\n2. Document', 'Which hazards were found?\n1. Collision\n2. Uncontrolled motion', 'I recommend these steps:\n1. Read\n2. Review', '```\nWhich option should I use?\n1. A\n2. B\n```', '| Option | Result |\n| --- | --- |\n| A | B |']) {
    const raw = { role: 'assistant', content }; expect(attachFollowUpChoices(raw)).toBe(raw);
  }
});

test('explicit marker choices are removed from visible text and only complete payloads become controls', () => {
  const content = `Choose a view.\n<collaborator_choices>${JSON.stringify(choices)}</collaborator_choices>`;
  const result = attachFollowUpChoices({ role: 'assistant', content });
  expect(result.content).toBe('Choose a view.'); expect(result.choicePrompt.options).toHaveLength(2);
  for (const suffix of ['<collaborator_choices>', '<collaborator_ch', '<collaborator_choices>{"question":']) expect(hideChoicePayload('Visible answer.\n' + suffix)).toBe('Visible answer.');
  expect(hideChoicePayload('Ordinary answer.')).toBe('Ordinary answer.');
});

test('choice controls cannot replace action plans, stopped responses, failed replies or review lists', () => {
  for (const metadata of [{ role: 'user' }, { workspaceActionPlan: { actions: [] } }, { requestFailed: true }, { responseStopped: true }, { designReviewResult: { total: 1 } }]) {
    const message = { role: 'assistant', content: 'Which option should I use?\n1. Apply\n2. Cancel', ...metadata };
    expect(attachFollowUpChoices(message, choices)).toBe(message);
  }
});

test('only the latest unanswered question is current and matching accepts typed or spoken labels', () => {
  const message = attachFollowUpChoices({ role: 'assistant', content: choices.question }, choices);
  expect(latestChoiceEntry([message, { role: 'user', content: 'Table' }])).toMatchObject({ messageIndex: 0 });
  expect(latestChoiceEntry([message, { role: 'assistant', content: 'A newer reply.' }])).toBeNull();
  expect(latestChoiceEntry([{ ...message, choicePrompt: { ...message.choicePrompt, completed: true } }])).toBeNull();
  expect(matchFollowUpOption(message.choicePrompt, 'Choose Table')?.value).toBe('option-1');
  expect(matchFollowUpOption(message.choicePrompt, 'Not one of those')).toBeUndefined();
});

test('custom domain scopes retain their behavior and question context stays bounded and non-executable', () => {
  const prompt = { ...normalizeFollowUpChoices(choices), originalPrompt: 'Summarize these records.', selectedValue: 'option-1', completed: true };
  expect(choiceOptions({ options: [{ value: 'domain-custom', label: 'Custom scope', custom: true, reviewType: 'functional' }] })).toEqual([
    { value: 'domain-custom', label: 'Something else', custom: true, reviewType: 'functional' },
  ]);
  const history = followUpHistoryContent({ content: 'x'.repeat(5000), choicePrompt: prompt });
  expect(history.length).toBeLessThanOrEqual(3000); expect(history).toContain('Document'); expect(history).toContain('Table');
  const context = followUpAnswerContext(prompt, 'Explain the tradeoffs instead.');
  expect(context).toContain('Explain the tradeoffs instead.'); expect(context).toContain('does not apply saved edits');
});
