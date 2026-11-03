# Final desktop release regression review

Review all pending tracked and untracked changes in the public xhandle-open and private xhandle-desktop repositories against their current HEADs. Include the accumulated diagnostics, requirements derivation, large hazard CSV import/Undo, storage, worker lifecycle, and column-filter changes. Read applicable repository instructions and prior review findings. Preserve the running preview, installed app, and all user data.

Do not change production code, commit, push, change source pins, sign, publish, or update the release feed. Create isolated reproductions if needed and report confirmed findings with severity, trigger, impact, and file/line references. Do not spawn agents or call paid AI providers.

Check cancellation and durable-commit races, worker ownership across remounts and workspace changes, atomic publication, cleanup, stale-source detection, legacy imports, exact Undo, requirement derivation and downstream invalidation, bounded memory, filter request identity, trusted diagnostic IPC, redaction, crash recovery, and desktop build provenance. Preserve Collaborator review prompts. Chrome/Electron responsiveness parity is explicitly outside this release gate.

Run the complete native desktop tests and relevant shared regression suites, whitespace checks, and appropriate build/smoke checks. Use disposable profiles for runtime tests. Identify whether the actual current source has packaged coverage; prior fixtures must be labeled with their source correspondence. Avoid changing the running preview or repeating expensive stress matrices without a concrete reason.

Write a review report distinguishing confirmed bugs, unresolved coverage, and normal release assembly steps. State whether the changes can proceed to commit/build and what remains before publishing. Passing tests cannot guarantee absence of bugs. Do not claim that any update was published.
