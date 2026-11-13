# Concise artifact generation review — November 8, 2026

## Finding

The previous implementation bounded individual responses but did not bound the
whole run or the growth of a document. Each section independently processed every
90,000-character evidence group, and the resulting objects were concatenated.
Every later project document also received the proposed objects of every earlier
document. Thus source groups multiplied by sections, generated content became
downstream input, and adaptive subdivision/retries multiplied the work further.
Removing final document-size/object-count rejections preserved completed work but
did not address this amplification. The user's overnight run has not been read
from their private browser database; these findings come from code inspection and
synthetic reproductions, not measurement of that specific run.

## Change

- Small source selections go directly to section synthesis, targeting 6–12
  concise objects, normally 40–120 words each. Template guidance still requires
  distinct supported requirements, constraints, interfaces and explicit gaps.
  Previously written section titles/topics discourage repetition across sections.
- Large selections are reviewed once per document in bounded source groups.
  Every selected citable source belongs to a group; sources are not sampled.
  Each review produces at most 12 facts/gaps with text up to 1,200 characters.
  The prompt requires material requirements, numeric constraints, interface
  details and uncertainty, rather than one object per input record.
- The shared brief is reused for every section. If necessary, the brief is
  consolidated again, with a maximum of three review rounds and a 60,000-character
  brief target. Normal work becomes evidence-group reviews plus section requests,
  instead of evidence groups multiplied by sections. Oversized brief output gets
  a bounded corrective retry, not another expanding section tree.
- Brief citations resolve through each consolidation round to original source
  IDs. Brief IDs never become published trace links. Unresolved brief entries
  remain gaps even if a later response labels them as requirements. Only exact
  duplicate facts with identical evidence are removed deterministically.
- Full original source manifests and architectural supporting details remain
  available. A draft produced through a brief shows cited/uncited source counts
  and a control to open its document and full readable source register. Citations
  and successful generation do not establish exhaustive requirements coverage.
- A single run has a shared 120-request / 15-minute budget. Project documents,
  retries and evidence reviews share it; the counter does not reset for each
  document. Reaching either bound aborts the active client request, prevents
  further requests and checkpoints a readable paused reason. This bounds work;
  it does not promise completion against an unavailable provider. Aborting a
  client request also cannot guarantee that a remote provider stops computation.
- Activities and project progress identify evidence review, evidence group,
  section synthesis and the number of AI requests made in the current run.

## Recovery and compatibility

Evidence reviews and sections are checkpointed independently. Resume reuses
completed reviews and sections when their saved source hash is unchanged. Late
responses after a run deadline cannot overwrite a paused checkpoint. Complete
legacy drafts, including those above the former 1,000-object limit, still resume
through validation without new AI requests. Manual content, revision review,
joint project acceptance, exact source snapshots and existing native views remain.

For a large-input legacy draft with an unfinished section, saved partial parts
remain stored, but the missing section is now synthesized from a review of the
complete saved evidence instead of continuing to concatenate source-group parts.
Completed legacy sections are not silently rewritten. Use a fresh update to apply
concision to already-generated sections as well. Accepted revisions remain until
the new proposal is reviewed and accepted.

Compression necessarily requires engineering review: the implementation cannot
prove that the model retained every material constraint. Full sources remain
inspectable, gaps remain explicit, and source coverage counts are not a semantic
completeness score. Persistent invalid output, an individual source too large for
one request, excessive scope, changed sources or unavailable storage/provider can
still require intervention; none is mislabeled successful completion.

## Validation

Regression coverage includes one evidence pass followed by six section requests,
multi-round consolidation of multi-megabyte upstream documents, canonical
citations through multiple review rounds, unresolved evidence propagation,
request/deadline cancellation, checkpoint reuse and late-response isolation.
Project tests verify the run budget spans documents and completed documents are
not regenerated on resume. UI checks cover coverage feedback, the readable source
register, and evidence-stage/request-count feedback in Activities.

All 166 artifact tests across 13 suites passed. Changed files passed lint.
The normal production build passed with existing repository warnings; strict
CI build mode rejects those existing warnings. The disposable Electron browser
regression passed with 68 synthetic AI calls, including two evidence-group reviews
and six section requests for the new large-input fixture, readable coverage
feedback, nonempty canonical citations, unresolved-brief labeling, acceptance,
legacy draft recovery, native views, architecture, exports and reload. Logs:
`/tmp/xhandle-concise-final-tests.log`, `/tmp/xhandle-concise-final-lint.log`,
`/tmp/xhandle-concise-final-build.log`, `/tmp/xhandle-concise-browser.log`.
Provider responses are synthetic; live model latency and semantic quality have
not been benchmarked by these checks. No personal browser data was modified.
