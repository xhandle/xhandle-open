# Reports: incomplete AI responses

The sidebar Reports workflow can display Safari's `JSON Parse error: Unexpected EOF` while generating a Subsystem Design Document. The screenshot alone does not identify the failed stage or establish whether the HTTP response body or the AI-generated JSON was incomplete.

## Reproduction and cause

The released `generateAgenticReport.js` gives every call only 1,200 output tokens, including planning, summaries, audit, and final Markdown synthesis. It returns empty completion content without checking the finish reason. Planning and audit subsequently call `JSON.parse` outside the request retry loop. Summary parsing also happens after that loop. Empty, truncated, or malformed model output therefore bypasses request retries and can surface a raw parser error. An invalid HTTP JSON envelope can surface the same parser error after retries.

A synthetic baseline reproduction loaded the committed implementation and returned an empty completion with `finish_reason: "length"`. Subsystem Design Document generation failed with `SyntaxError` at planning. This demonstrates a matching failure mechanism; no customer provider response or server request log was available to confirm which mechanism produced the screenshot.

## Local fix

- Use the shared configured backend URL for `/api/chat`, preserving selected-provider authentication for browser and Electron hosts.
- Allow 8,192 output tokens initially. A provider-reported output cutoff increases subsequent attempts to a maximum of 16,384 tokens. There remain at most three attempts per request.
- Check HTTP-envelope parsing, completion content, provider refusal, and truncation before accepting output. Reject truncated Markdown instead of presenting a cut-off report as complete.
- Parse and validate planning, summary, and audit objects within the retry boundary. Validate audit indexes before revision work.
- Stop if every findings summary failed, including for design-document templates, rather than synthesizing as though the findings were processed.
- Report the failed stage and actionable guidance. Do not log raw provider responses, source rows, or prompts. Do not retry authentication failures, other non-transient HTTP errors, or provider refusals.

The existing report controls, rendering, export formats, and storage are unchanged. The shared fix has not been committed, pushed, or included in a desktop update.

## Validation

- Baseline reproduction: empty, length-limited planning completion produces the raw parsing failure.
- Frontend regression checks: 27 tests across three suites passed, covering report generation, provider routing, and provider preferences. Report cases cover complete subsystem reports, bounded retries and budgets, empty/malformed/truncated responses, invalid HTTP JSON bodies, schema validation, audit revisions, failed summaries, authentication/refusals, Claude selection, and Safety, Custom, and Functional Architecture Definition report paths.
- Backend provider compatibility: 27 tests passed, covering workflow auth/routing, provider payloads, token compatibility, and transport errors.
- Focused ESLint and `git diff --check` passed.
- The optimized production build passed with existing repository lint and bundle-size warnings.

All generation tests use synthetic data and mocked AI responses. No paid provider calls or personal project changes were made. A real report generation with the user's selected provider remains a useful acceptance check; automated checks cannot guarantee that a provider will always return a complete report within the bounded budget.

## Follow-up: System Design Document audit rejection

The subsequent screenshot shows `Report audit: the AI provider did not return the required complete structured response`. This identifies a later-stage parsing or validation failure after the first local fix; it does not reveal the actual provider response. The first fix did not establish successful live report generation.

Review found that the audit prompt requested positional indexes over unlabeled summaries without specifying their base. Its example used placeholders rather than valid JSON. Validation also unnecessarily required two empty arrays for a complete `needsRevision: false` decision. Repeating the same prompt on retries did not correct those contract problems.

The follow-up uses explicit summary identifiers and pairs each revision's identifier with its advice in one object. JSON stages supply a complete schema in system instructions. Supported OpenAI GPT models additionally use the backend's existing native `response_format` forwarding for strict structured output; Claude, Gemini, and other model paths retain prompt-based contracts and local validation. The schema stays constant-sized instead of enumerating every summary identifier, and membership is checked locally. See [OpenAI's structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) for the API response-format behavior.

Complete no-revision decisions may omit unused arrays or set them to null. Contradictory decisions, unknown identifiers, duplicate revisions, empty advice, and truncated JSON still fail. Complete JSON surrounded by commentary is accepted with quote-aware object extraction; missing closing braces are never repaired. Format failures now distinguish invalid JSON from invalid structured fields, and retries receive corrective instructions without echoing the rejected provider text.

Successful summaries also retain references to their actual source chunk. This fixes an existing audit-revision bug: when an earlier summary failed, successful summaries were compacted but revision source rows were still chosen using their original positional offsets. Revision advice now uses the source rows that produced the selected successful summary. Audits with no available summaries are explicitly recorded as skipped rather than asking an AI to audit nothing.

Follow-up checks passed 40 frontend tests across three suites and 27 backend provider-compatibility tests, plus focused ESLint, `git diff --check`, and a fresh optimized production build (existing warnings). Cases include no-revision omissions/nulls, complete wrapped JSON with quoted braces, stable identifiers, native-format/provider separation, corrective bounded retries, contradictory decisions, truncated audit output, and revision source integrity after an earlier summary fails. The exact live response behind the screenshot remains unavailable; a successful generation with the user's provider is still the acceptance check.
