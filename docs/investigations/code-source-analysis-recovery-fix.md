# Code architecture incomplete-run recovery

Historical first repair. Its retry/deadline/selection limits are superseded by [automatic completion recovery](code-source-automatic-recovery.md).

## Report and findings

The October 5 report shows both local and GitHub analysis ending with 16 failed files, followed by an empty architecture view. The source-equivalence implementation deliberately withholds publication when any selected file fails, preserving the previously published architecture. A first analysis has no previous architecture, so this appeared to discard the run. Successful file results were checkpointed, but the UI exposed neither those drafts nor individual failure reasons.

The new strict response reader also treated escaped pipes, pipes in inline code, and optional outside Markdown pipes as malformed output. It rejected truncated responses but provided no recovery from formatting/truncation failures. The existing output limit is 1,800 tokens, while the prompt requests detailed descriptions, making truncation a relevant failure path. The screenshot contains only the aggregate failure count: the specific causes of the customer's 16 failures have **not** been established from their checkpoint.

## Changes

- Parse eight-column Markdown tables, including optional outside pipes, escaped pipes, inline code, CRLF and reordered canonical headers. Continue rejecting incomplete relationships and malformed rows rather than silently losing them.
- Retry malformed/transient responses and split truncated source chunks into smaller sections. Cap each original chunk at three actual requests, retaining the existing per-file deadline and cancellation. Record truncated requests in usage metrics. Permanent errors and changed run settings are not retried.
- Show an incomplete-run panel for the active project/repository, including saved file/relationship counts, per-file failure reasons, a read-only draft preview, checkpoint export, and retry. It reads existing checkpoints and works after reopening the project following a reload.
- Keep incomplete rows separate from the published architecture and downstream inputs. Preserve any previously completed architecture. Route incomplete-run failures to recovery instead of reopening repository configuration. Other errors retain their existing handling.
- Timestamp successful publication and hide superseded checkpoints. Retry resumes compatible checkpoints; changed source/settings can require a fresh run. Local folder sources may require reconnection after a browser reload.

## Validation

- 225 tests in 30 affected suites pass, including parser/retry limits, recovery rendering/errors, source equivalence, downstream compatibility, hazard preprocessing and remediation.
- Production build passes with existing warnings; new component/parser/storage lint and diff whitespace checks pass.
- `code-source-pipeline-check.cjs`: real shared generator, intercepted GitHub/AI; fresh local/GitHub equivalence, omission/duplication, stable trace IDs, retained prior rows on malformed/truncated failures, atomic portable import.
- `code-source-retry-check.cjs`: both adapters checkpoint a successful file, withhold publication after another fails, retry only the failed file, publish successfully, and recover from controlled output truncation. Three-request cap remains enforced.
- `code-source-recovery-check.cjs`: isolated browser fixture checks old checkpoint visibility after reload/reopening, draft preview/export, scope isolation, no partial publication, hiding superseded checkpoints, and the actual Analyze-menu failure path.

All browser/API fixtures are synthetic and isolated. No paid/live analysis, customer browser state, customer source upload, commit, or push was performed. These checks demonstrate recovery mechanics; they do not prove the customer's specific 16 failures will all succeed on retry. Their exact messages are now visible in File failure details.
