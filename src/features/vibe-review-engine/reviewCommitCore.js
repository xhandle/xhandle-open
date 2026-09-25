/**
 * The domain-neutral commit-and-advance skeleton shared by every Vibe Review.
 *
 * Hazard analysis and functional decomposition review different artifacts and
 * record different decisions, but the sequence that makes a review trustworthy
 * is identical: guard the item, write, verify, record, then advance exactly
 * once. Keeping that sequence in one place is the point -- the two domains
 * previously had separate copies of it and had already drifted apart (one
 * recovered a stranded `applying` state on load, the other did not).
 *
 * A domain supplies an adapter describing only what differs: how it names a
 * row, what a decision record looks like, and whether a written decision can
 * still be unresolved. The core owns the ordering and the invariants.
 */

export const DECISION_OUTCOME = Object.freeze({
  /** Written, recorded, cursor advanced. */
  APPLIED: "applied",
  /** Written, but the domain says it is still unresolved; position is held. */
  UNRESOLVED: "unresolved",
  /** The row vanished from the artifact; the queue advances past it. */
  SOURCE_ROW_MISSING: "source_row_missing",
  /** Nothing was written. The artifact and the cursor are untouched. */
  COMMIT_FAILED: "commit_failed",
  /** The row moved since the proposal was formed. Nothing was written. */
  CONFLICT: "conflict",
});

/**
 * A stable identity for one attempt at one queue position.
 *
 * Two stores back a review -- the artifact and the session -- and they cannot
 * commit together, so a crash between the write and the cursor advance is
 * always possible. The key does not make that atomic; it makes it *detectable*:
 * a decision already recorded under this key is refused outright, and a commit
 * that begins while a previous attempt at the same key is still marked pending
 * is flagged so the undo path knows its restore baseline may describe the
 * post-write row rather than the pre-write one.
 */
export const decisionKeyFor = (session, rowId) => `${session?.id || ""}:${rowId}:${session?.cursor ?? ""}`;

/**
 * @param {object} input
 * @param {object} input.session  the active review session
 * @param {object} input.card     the review card being acted on
 * @param {string} input.action   the reviewer's action
 * @param {object} [input.context] domain payload (proposal, decision, feedback)
 * @param {object} adapter        see the module comment
 * @param {object} ports          injected side effects
 */
export async function commitReviewDecision({ session, card, action, context = {} }, adapter, ports = {}) {
  const {
    applyDecision,
    saveSession = () => {},
    appendAudit,
    captureDecision,
    emitCellImpacts,
    onBookkeepingError,
    now = () => new Date().toISOString(),
  } = ports;

  if (!session) throw new Error("A review session is required to commit a decision.");
  if (!adapter) throw new Error("A domain adapter is required to commit a decision.");
  if (typeof applyDecision !== "function") throw new Error("An applyDecision port is required to commit a decision.");

  // --- guards: nothing below may run against the wrong item ------------
  if (adapter.currentRowId(session) !== adapter.cardRowId(card)) {
    return { outcome: DECISION_OUTCOME.COMMIT_FAILED, session, committed: false, stale: true,
      error: "This review has already moved past that item." };
  }
  const committable = adapter.committable({ card, context, action });
  if (!committable.ok) {
    return { outcome: DECISION_OUTCOME.COMMIT_FAILED, session, committed: false, committable: false,
      error: committable.error };
  }

  const rowId = adapter.cardRowId(card);
  const decisionKey = decisionKeyFor(session, rowId);
  if (session.decisions?.some((entry) => entry?.decisionKey === decisionKey)) {
    return { outcome: DECISION_OUTCOME.COMMIT_FAILED, session, committed: false, replay: true,
      error: "That decision has already been applied to this item." };
  }
  // A pending marker left over from the same key means a previous attempt was
  // interrupted after it began writing.
  const interrupted = session.pendingCommit?.decisionKey === decisionKey;

  // The row the reviewer was shown, captured when the proposal was recorded.
  const expectedRowFingerprint = session.currentRowSnapshot && adapter.rowFingerprint
    ? adapter.rowFingerprint(session.currentRowSnapshot)
    : null;

  let working = adapter.transition(session, { type: "applying" });
  working = { ...working, pendingCommit: { decisionKey, rowId, startedAt: now() } };
  saveSession(working);

  // A deterministic rejection wrote nothing, so the pending marker must not be
  // left behind to make a later retry look like an interrupted attempt.
  const rejectCleanly = (patch) => {
    saveSession({ ...session, pendingCommit: null });
    return { session, committed: false, ...patch };
  };

  // --- the write -------------------------------------------------------
  let result;
  try {
    result = await applyDecision(adapter.applyArgs({ session: working, card, action, context, expectedRowFingerprint }));
  } catch (error) {
    // Nothing was written: the artifact layer verifies before it persists.
    return { outcome: DECISION_OUTCOME.COMMIT_FAILED, session, committed: false, error: error?.message || String(error) };
  }

  if (result?.conflict) {
    return rejectCleanly({
      outcome: DECISION_OUTCOME.CONFLICT,
      conflict: true,
      result,
      error: "This row changed after the proposal was prepared, so the decision was not applied. Review the updated row and decide again.",
    });
  }

  if (result?.missing) {
    const advanced = adapter.transition(working, { type: "missing", record: adapter.missingRecord(card) });
    saveSession(advanced);
    return { outcome: DECISION_OUTCOME.SOURCE_ROW_MISSING, session: advanced, committed: false, result };
  }

  const validated = adapter.validateResult(result);
  if (!validated.ok) {
    return rejectCleanly({ outcome: DECISION_OUTCOME.COMMIT_FAILED, error: validated.error });
  }

  // --- past this line the artifact is written --------------------------
  const record = {
    ...adapter.buildRecord({ session: working, card, action, context, result, now }),
    decisionKey,
    // The pre-decision values recorded here came from a row a previous attempt
    // may already have written, so undo must not trust them blindly.
    ...(interrupted ? { replayedAfterInterruption: true, baselineUncertain: true } : {}),
  };
  const holding = adapter.holdPosition?.({ session: working, card, context, result }) || null;

  // Bookkeeping must not be able to fail a stored decision.
  let bookkeepingComplete = true;
  try {
    const changedColumns = adapter.changedColumns?.({ result }) || [];
    if (changedColumns.length) {
      emitCellImpacts?.({ rowId: adapter.cardRowId(card), changedColumns, session: working });
    }
    appendAudit?.(adapter.auditRecord({ session: working, record, result, holding }));
    await captureDecision?.({ record, result, session: working, action, decision: record.decision ?? record.newReviewValue, context });
  } catch (error) {
    bookkeepingComplete = false;
    onBookkeepingError?.(error);
  }

  // A domain may decide a written change still leaves the item unresolved, in
  // which case the same row must be decided again rather than advancing.
  if (holding) {
    const held = { ...working, ...holding.sessionPatch, updatedAt: now() };
    saveSession(held);
    return { outcome: DECISION_OUTCOME.UNRESOLVED, session: held, committed: true, bookkeepingComplete, record, result };
  }

  const committed = adapter.transition(working, { type: "decision", record, ...adapter.decisionEventExtras?.({ result }) });
  const advanced = { ...committed, pendingCommit: null };
  saveSession(advanced);
  return {
    outcome: DECISION_OUTCOME.APPLIED,
    session: advanced,
    committed: true,
    bookkeepingComplete,
    completed: advanced.state === adapter.states.COMPLETED,
    record,
    result,
    newReviewValue: record.newReviewValue ?? record.decision,
  };
}

export const UNDO_OUTCOME = Object.freeze({
  RESTORED: "restored",
  NOTHING_TO_UNDO: "nothing_to_undo",
  RESTORE_FAILED: "restore_failed",
});

/**
 * Reverse the most recent applied decision and return the cursor to its row.
 *
 * The audit trail is append-only: undoing does not delete the original record,
 * it adds a compensating one. Both remain visible, which is what a reviewer
 * needs in order to see that a decision was made and then withdrawn.
 */
export async function undoReviewDecision({ session }, adapter, ports = {}) {
  const { undoDecision, saveSession = () => {}, appendAudit, captureDecision, onBookkeepingError, now = () => new Date().toISOString() } = ports;
  if (!session) throw new Error("A review session is required to undo a decision.");
  if (!adapter) throw new Error("A domain adapter is required to undo a decision.");
  if (typeof undoDecision !== "function") throw new Error("An undoDecision port is required to undo a decision.");

  const last = session.decisions?.[session.decisions.length - 1];
  if (!last) {
    return { outcome: UNDO_OUTCOME.NOTHING_TO_UNDO, session, restored: false,
      error: "There is no applied review decision to undo." };
  }

  if (last.baselineUncertain) {
    return { outcome: UNDO_OUTCOME.RESTORE_FAILED, session, restored: false, baselineUncertain: true,
      error: "This decision was re-applied after an interrupted attempt, so the values recorded before it may already reflect the change. Undo was refused rather than risk restoring the wrong row; review the row directly." };
  }

  let undoResult;
  try {
    undoResult = await undoDecision(adapter.undoArgs({ session, last }));
  } catch (error) {
    // The decision stands; the reviewer keeps whatever they had.
    return { outcome: UNDO_OUTCOME.RESTORE_FAILED, session, restored: false, error: error?.message || String(error) };
  }

  const reverted = adapter.transition(session, { type: "undo", ...adapter.undoEventExtras?.({ undoResult }) });
  saveSession(reverted);

  let bookkeepingComplete = true;
  try {
    appendAudit?.(adapter.undoAuditRecord({ session: reverted, last, now }));
    await captureDecision?.({ last, undoResult, session: reverted });
  } catch (error) {
    bookkeepingComplete = false;
    onBookkeepingError?.(error);
  }

  return { outcome: UNDO_OUTCOME.RESTORED, session: reverted, restored: true, bookkeepingComplete, last, undoResult };
}

/** Defer the current item without touching the artifact. */
export function skipReviewItem({ session, card, reason = "" }, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to skip an item.");
  const advanced = adapter.transition(session, { type: "skip", record: adapter.skipRecord({ card, reason }) });
  saveSession(advanced);
  return { session: advanced, completed: advanced.state === adapter.states.COMPLETED };
}

/** End the review early, keeping every decision already applied. */
export function stopReview({ session }, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to stop a review.");
  const stopped = adapter.transition(session, { type: "stop" });
  saveSession(stopped);
  return { session: stopped };
}

/**
 * Suspend the active review. Pausing never touches the artifact, so it is safe
 * at any point: the cursor, the queue and every applied decision are kept.
 */
export function pauseReview({ session }, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to pause a review.");
  const paused = adapter.transition(session, { type: "pause" });
  saveSession(paused);
  return { session: paused };
}

/**
 * Resume a suspended review.
 *
 * A finished review cannot be resumed -- restarting it would re-apply decisions
 * that are already part of the artifact. A review whose saved current row no
 * longer matches the artifact is reported rather than resumed, so the reviewer
 * decides what to do instead of silently reviewing a row that moved underneath
 * them.
 */
export function resumeReview({ session, currentRowSnapshot = null }, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to resume a review.");
  if ([adapter.states.COMPLETED, adapter.states.CANCELLED].includes(session.state)) {
    return { session, resumed: false, error: "This review is finished and cannot be resumed." };
  }
  if (!adapter.currentRowId(session)) {
    return { session, resumed: false, error: "This saved review has no current row and cannot be safely resumed. Start a new review." };
  }
  if (session.currentRowSnapshot && currentRowSnapshot
    && JSON.stringify(session.currentRowSnapshot) !== JSON.stringify(currentRowSnapshot)) {
    return { session, resumed: false, rowChanged: true,
      error: "The saved current row changed after the review was paused. No data was changed; restart or review the updated row in a new session." };
  }
  const resumed = adapter.transition(session, { type: "resume" });
  saveSession(resumed);
  return { session: resumed, resumed: true, awaitingDecision: resumed.state === adapter.states.AWAITING };
}

/**
 * Record an AI proposal against the current item, with its verdict.
 *
 * A proposal that failed validation is still stored, because the reviewer can
 * act on the row manually. The verdict must be stored with it: resuming used to
 * restore any saved proposal as valid, so a failed safety assessment came back
 * labelled "passed the configured safety-classification checks".
 */
export function recordReviewProposal({
  session, proposal, currentRowSnapshot = null, valid = null, evidenceGap = "", errors = [],
}, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to record a proposal.");
  const next = adapter.transition(session, { type: "proposal", proposal, currentRowSnapshot });
  const withVerdict = valid === null ? next : {
    ...next,
    proposalValidation: { valid: Boolean(valid), evidenceGap: evidenceGap || "", errors: [...(errors || [])] },
  };
  saveSession(withVerdict);
  return { session: withVerdict };
}

/** Rebuild the normalized shape a review card expects from a stored session. */
export function storedProposalVerdict(session) {
  const stored = session?.proposalValidation;
  return {
    valid: stored ? stored.valid : true,
    evidenceGap: stored?.evidenceGap || "",
    errors: stored?.errors || [],
    proposal: session?.proposal,
  };
}

/** Advance past a queued row that no longer exists in the artifact. */
export function recordMissingRow({ session, card, reason = "" }, adapter, ports = {}) {
  const { saveSession = () => {} } = ports;
  if (!session) throw new Error("A review session is required to record a missing row.");
  const record = { ...adapter.missingRecord(card), ...(reason ? { reason } : {}) };
  const next = adapter.transition(session, { type: "missing", record });
  saveSession(next);
  return { session: next, completed: next.state === adapter.states.COMPLETED };
}
