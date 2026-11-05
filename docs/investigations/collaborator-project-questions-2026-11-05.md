# Collaborator project-question reliability

## Reproduction

The user reported that arithmetic succeeded but “summarize the vulnerableapp project” failed at the first response protocol. With explicit user approval, a probe sent that example, the preceding arithmetic exchange, and minimal dashboard/project-name metadata through the local preview’s configured provider. No saved project bodies were sent.

The baseline provider returned ordinary prose offering to retrieve records instead of the required JSON request. The parser therefore failed before scoped retrieval. This reproduced the reported error. A revised first-response instruction returned a valid workspace_read object, but repeated the current project’s name in the optional prior-conversation reference. That redundant reference triggered a second validation failure.

The preview had Anthropic selected with no explicit stored model preference. Server timing metadata identifies the model actually used as `claude-haiku-4-5` (the configured default). This is not evidence of testing Haiku 5.5 or every other provider/model. The final corrected live probe returned an accepted scoped request with server elapsed time 678 ms; this measures the first decision, not end-to-end project-summary latency.

## Changes

- Explain what each data domain contains and require actual analysis evidence for technical summaries.
- Treat a named-project question as requesting the relevant read-only lookup, without an unnecessary permission question about internal data areas.
- Accept one complete JSON object surrounded by commentary, retaining schema and scope validation. Reject multiple/unfinished objects and unsupported operations.
- Retry a format failure once using the same bounded conversation and provider settings. A failed retry remains an error; there is no whole-workspace fallback or unbounded retry.
- Discard a redundant reference already present in the current question (case insensitive). The original user question still determines project/history permissions. Invented references and assistant-only references remain invalid.
- Report a repeated formatting failure without blaming provider configuration, and remove duplicated punctuation in other error messages.

## Validation

- 198 tests passed across eight suites: context protocol/recovery, component behavior, chat transport, conversation routing, read sessions, actual IndexedDB reads, graph context and index scope.
- Optimized build passed (`CI=false`, existing lint/bundle-size warnings).
- Production Chrome and Electron each passed 13 scenarios, including arithmetic/general questions under a held storage lock, named-project summary with one format-recovery request, technical named-function lookup, invalid capability rejection, and an exact requirements count. No uncaught runtime exceptions were recorded.
- Summary/function answer requests contained the synthetic saved architecture body and targeted read evidence, and excluded the foreign project's secret marker. The named CBA project was resolved from the dashboard while a different regular project had previously been active. Ordinary questions completed while storage remained locked.
- Selected provider/model settings were preserved. The Electron fixture used Anthropic Haiku 4.5, for which the existing app correctly omits unsupported effort settings. Chrome used the OpenAI GPT-5/high fixture.
- The real-provider first decision succeeded, and replaying the original malformed response through the single live recovery request also produced an accepted workspace_read. These live probes sent only the approved example/conversation and view/project-name metadata.
- `git diff --check` passed.

[Compact native test evidence](collaborator-project-questions-2026-11-05.json) is stored beside this report. The native tests deliberately use synthetic saved records and a local mock provider; the real-provider probes verify routing only. They do not establish factual answer quality or end-to-end performance on the customer's full project.

During harness development an assertion mistakenly applied the preceding technical-case expectation to a later deterministic count request. Resetting scenario state corrected that test bug. A separate test assertion expected an effort header for Haiku 4.5; it was corrected to account for the existing unsupported-effort behavior. Neither required production changes.

## Limits

These changes address demonstrated response-protocol failures, not a guarantee that every technical question can be answered. Answers remain limited by available/indexed records, requested scope, bounded read budgets, model reasoning and provider availability. Complex questions can require multiple model calls. The read planner and evidence layer must report unavailable, partial, or ambiguous data rather than inventing conclusions. No desktop release is published by this work.
