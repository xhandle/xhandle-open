import React, { useEffect, useMemo, useState } from "react";
import {
  SAFETY_REMEDIATION_VERIFICATION_CATEGORIES,
  SAFETY_REMEDIATION_VERIFICATION_DECISIONS,
  VERIFICATION_DECISION_LABELS,
} from "./safetyRemediationTypes";
import { detectVerificationCommands, getVerificationStatus, proposeVerificationRepairs, runVerificationCommands } from "./safetyVerificationClient";

const CATEGORY_LABELS = {
  [SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.BUILD]: "Build",
  [SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.LINT]: "Lint",
  [SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.TYPECHECK]: "Type Check",
  [SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.UNIT]: "Unit Tests",
  [SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.CUSTOM]: "Custom / Other",
};

const SUMMARY_CATEGORIES = [
  SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.BUILD,
  SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.LINT,
  SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.TYPECHECK,
  SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.UNIT,
];

function makeClientId(prefix = "verification") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function statusLabel(status) {
  if (!status) return "Not Run";
  return String(status).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function isBuildOnlyEmbeddedCheck(result) {
  const command = result?.command || "";
  return /\bpio\s+test\b/i.test(command) && /--without-testing\b/i.test(command);
}

function resultStatusLabel(result) {
  if (isBuildOnlyEmbeddedCheck(result) && result?.status === "passed") return "Passed Build-Only Check";
  return statusLabel(result?.status);
}

function categoryStatus(category, detectedCommands = [], latestRun = null) {
  const detected = detectedCommands.some((command) => command.category === category) ||
    latestRun?.commands?.some((command) => command.category === category);
  const results = (latestRun?.results || []).filter((result) => result.category === category);
  if (!detected) return "Not Detected";
  if (!results.length) return "Not Run";
  if (results.some((result) => result.status === "failed" || result.status === "timed_out")) return "Failed";
  if (results.every((result) => result.status === "passed")) return "Passed";
  return "Partial";
}

function summaryText(run) {
  if (!run?.results?.length) return "No verification commands have been run yet.";
  const passed = run.results.filter((result) => result.status === "passed").length;
  const failed = run.results.filter((result) => result.status === "failed" || result.status === "timed_out").length;
  const buildOnlyChecks = run.results.filter((result) => isBuildOnlyEmbeddedCheck(result)).length;
  const buildOnlySuffix = buildOnlyChecks ? ` Includes ${buildOnlyChecks} no-hardware embedded build verification command${buildOnlyChecks === 1 ? "" : "s"}.` : "";
  return `${passed} passed, ${failed} failed across ${run.results.length} command${run.results.length === 1 ? "" : "s"}.${buildOnlySuffix}`;
}

function resultTone(status) {
  if (status === "passed") return "text-emerald-700";
  if (status === "failed" || status === "timed_out") return "text-rose-700";
  return "text-slate-600";
}

function formatElapsed(startedAt, completedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(completedAt || new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "0s";
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function VerificationPanel({
  finding,
  patchProposal,
  verificationRuns = [],
  busy = false,
  buildHandoff,
  onVerificationRunSaved,
  onVerificationDecisionSaved,
  onSendRepairProposal,
  onSendRepairProposals,
}) {
  const [detectedCommands, setDetectedCommands] = useState([]);
  const [selectedCommandIds, setSelectedCommandIds] = useState([]);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [reviewerComment, setReviewerComment] = useState("");
  const [repairProposals, setRepairProposals] = useState([]);
  const [liveRun, setLiveRun] = useState(null);

  const relevantRuns = useMemo(
    () => (verificationRuns || [])
      .filter((run) => run.safetyFindingId === finding?.id || run.patchProposalId === patchProposal?.id)
      .sort((a, b) => (Date.parse(b.completedAt || b.startedAt || 0) || 0) - (Date.parse(a.completedAt || a.startedAt || 0) || 0)),
    [finding?.id, patchProposal?.id, verificationRuns],
  );
  const latestRun = relevantRuns[0] || null;
  const activeRun = liveRun || latestRun;

  useEffect(() => {
    if (!activeRun?.commands?.length || detectedCommands.length) return;
    setDetectedCommands(activeRun.commands);
    setSelectedCommandIds(activeRun.commands.map((command) => command.id));
  }, [activeRun, detectedCommands.length]);

  useEffect(() => {
    if (!running) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await getVerificationStatus();
        if (cancelled) return;
        if (payload?.run) setLiveRun(payload.run);
      } catch {}
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running]);

  const groupedCommands = useMemo(() => {
    const groups = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((category) => [category, []]));
    detectedCommands.forEach((command) => {
      const category = groups[command.category] ? command.category : SAFETY_REMEDIATION_VERIFICATION_CATEGORIES.CUSTOM;
      groups[category].push(command);
    });
    return groups;
  }, [detectedCommands]);

  const handleDetect = async () => {
    setRunning(true);
    setMessage("Detecting verification commands from the active VS Code workspace...");
    try {
      const payload = await detectVerificationCommands({
        finding,
        patchProposal,
        handoff: buildHandoff?.(),
      });
      const commands = Array.isArray(payload.commands) ? payload.commands : [];
      setDetectedCommands(commands);
      setSelectedCommandIds(commands.map((command) => command.id));
      setMessage(commands.length
        ? `Detected ${commands.length} verification command${commands.length === 1 ? "" : "s"} in ${payload.workspaceRoot || "the active workspace"}.`
        : "No lightweight verification commands were detected. You can still record manual evidence below.");
    } catch (error) {
      setMessage(error?.message || "Failed to detect verification commands.");
    } finally {
      setRunning(false);
    }
  };

  const handleRunSelected = async () => {
    const selected = detectedCommands.filter((command) => selectedCommandIds.includes(command.id));
    if (!selected.length) {
      setMessage("Select at least one verification command to run.");
      return;
    }
    setRunning(true);
    setMessage("Running selected verification commands in VS Code...");
    try {
      setLiveRun(null);
      const payload = await runVerificationCommands({
        finding,
        patchProposal,
        commands: selected,
        handoff: buildHandoff?.(),
      });
      const run = {
        ...(payload.run || {}),
        id: payload.run?.id || makeClientId("verification-run"),
        projectId: finding?.projectId || "",
        repoId: finding?.repoId || "",
        remediationId: finding?.id || "",
        safetyFindingId: finding?.id || "",
        patchProposalId: patchProposal?.id || "",
        createdAt: payload.run?.startedAt || new Date().toISOString(),
        updatedAt: payload.run?.completedAt || new Date().toISOString(),
      };
      setLiveRun(run);
      await onVerificationRunSaved?.(run);
      setMessage(`Verification ${run.status || "completed"}. ${summaryText(run)}`);
    } catch (error) {
      setMessage(error?.message || "Verification run failed.");
    } finally {
      setRunning(false);
    }
  };

  const toggleCommand = (commandId) => {
    setSelectedCommandIds((prev) => prev.includes(commandId)
      ? prev.filter((id) => id !== commandId)
      : [...prev, commandId]);
  };

  const handleDecision = async (decision) => {
    if (decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE && !overrideReason.trim()) {
      setMessage("An override reason is required.");
      return;
    }
    const record = {
      decision,
      reviewerComment: reviewerComment.trim(),
      overrideReason: decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE ? overrideReason.trim() : "",
      reviewedAt: new Date().toISOString(),
    };
    await onVerificationDecisionSaved?.(latestRun, record);
    setMessage(decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE
      ? "Verification gate override recorded."
      : "Verification review decision recorded.");
  };

  const handleProposeRepairs = async () => {
    if (!latestRun) {
      setMessage("Run verification before asking xHandle to propose repairs.");
      return;
    }
    setRunning(true);
    setMessage("Triaging verification failures...");
    try {
      const payload = await proposeVerificationRepairs({ finding, patchProposal, run: latestRun });
      const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
      setRepairProposals(proposals);
      setMessage(proposals.length
        ? `Found ${proposals.length} verification failure repair/triage item${proposals.length === 1 ? "" : "s"}.`
        : "No safe automated repair was found for these verification results.");
    } catch (error) {
      setMessage(error?.message || "Failed to propose verification repairs.");
    } finally {
      setRunning(false);
    }
  };

  const disabled = busy || running || !finding;
  const sendableRepairProposals = useMemo(
    () => repairProposals.filter((proposal) => proposal.unifiedDiff),
    [repairProposals],
  );
  const progressCompleted = Math.max(0, activeRun?.progressCompleted || 0);
  const progressTotal = Math.max(progressCompleted, activeRun?.progressTotal || (running ? selectedCommandIds.length : activeRun?.commands?.length || 0));
  const progressPercent = progressTotal ? Math.max(progressCompleted === progressTotal && running ? 95 : 0, activeRun?.progressPercent ?? Math.round((progressCompleted / progressTotal) * 100)) : 0;
  const progressLabel = activeRun?.runningCommandLabel || (running ? "Starting verification..." : "");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Lightweight Verification</div>
          <p className="mt-1 text-xs text-slate-500">Detect and run local workspace commands through the xHandle VS Code extension before commit or push.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={handleDetect} className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            Detect Commands
          </button>
          <button type="button" disabled={disabled || !selectedCommandIds.length} onClick={handleRunSelected} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {running ? "Running..." : "Run Selected"}
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {SUMMARY_CATEGORIES.map((category) => {
          const status = categoryStatus(category, detectedCommands, latestRun);
          return (
            <div key={category} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{CATEGORY_LABELS[category]}</div>
              <div className={`mt-1 text-sm font-semibold ${status === "Passed" ? "text-emerald-700" : status === "Failed" ? "text-rose-700" : "text-slate-700"}`}>{status}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Verification Summary:</span> {summaryText(activeRun)}
      </div>

      {message && <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">{message}</div>}

      {running && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
            <div className="font-semibold">
              {progressTotal ? `Running command ${Math.min(progressCompleted + 1, progressTotal)} of ${progressTotal}` : "Running verification"}
            </div>
            <div>{formatElapsed(activeRun?.startedAt, activeRun?.completedAt)}</div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(8, progressPercent || 0))}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-800">
            <div className="min-w-0 truncate font-mono">{progressLabel}</div>
            <div>{progressPercent}% complete</div>
          </div>
          <div className="mt-1 text-[11px] text-blue-700">
            Some commands, especially PlatformIO, may take 30-90 seconds on a first run while dependencies build.
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {Object.entries(groupedCommands).map(([category, commands]) => (
          <div key={category} className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">{CATEGORY_LABELS[category]}</div>
            {commands.length ? (
              <div className="divide-y divide-slate-100">
                {commands.map((command) => (
                  <label key={command.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={selectedCommandIds.includes(command.id)} onChange={() => toggleCommand(command.id)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-800">{command.label}</span>
                      <span className="block font-mono text-xs text-slate-600">{[command.command, ...(command.args || [])].join(" ")}</span>
                      <span className="block text-xs text-slate-500">Detected from {command.detectedFrom}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-slate-500">Not detected.</div>
            )}
          </div>
        ))}
      </div>

      {activeRun?.results?.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Raw Logs</div>
          <div className="space-y-2">
            {activeRun.results.map((result) => (
              <details key={result.id || result.commandId} className="rounded-md border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
                  <span className={resultTone(result.status)}>{resultStatusLabel(result)}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{result.command}</span>
                </summary>
                <div className="border-t border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Exit code: {result.exitCode ?? "n/a"} · Duration: {Math.round((result.durationMs || 0) / 1000)}s</div>
                  {isBuildOnlyEmbeddedCheck(result) && (
                    <div className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
                      xHandle intentionally ran this PlatformIO command in no-hardware mode. A pass here means the embedded test target built successfully without uploading to or executing on a board.
                    </div>
                  )}
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{result.stdout || "(no stdout)"}</pre>
                  {result.stderr && <pre className="mt-2 max-h-64 overflow-auto rounded bg-rose-950 p-3 text-xs text-rose-50">{result.stderr}</pre>}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {activeRun?.results?.some((result) => result.status === "failed" || result.status === "timed_out") && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase text-amber-700">Verification Failure Repair</div>
              <p className="mt-1 text-xs text-amber-900">Ask xHandle to triage failed commands and propose a follow-up patch when it can prove a narrow source fix or generate a safe local test scaffold.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sendableRepairProposals.length > 1 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSendRepairProposals?.(sendableRepairProposals)}
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Send Combined Repair Patch
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={handleProposeRepairs}
                className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Propose Repairs
              </button>
            </div>
          </div>
          {repairProposals.length > 0 && (
            <div className="mt-3 space-y-2">
              {repairProposals.map((proposal) => (
                <div key={proposal.id} className="rounded-md border border-amber-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800">{proposal.title}</div>
                      <p className="mt-1 text-xs text-slate-600">{proposal.summary}</p>
                      <div className="mt-1 text-[11px] font-semibold uppercase text-slate-500">{proposal.kind} · confidence {Math.round((proposal.confidence || 0) * 100)}%</div>
                    </div>
                    {proposal.unifiedDiff && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSendRepairProposal?.(proposal)}
                        className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Send Repair to VS Code
                      </button>
                    )}
                  </div>
                  {proposal.unifiedDiff && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Review proposed diff</summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{proposal.unifiedDiff}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 rounded-md border border-slate-200 p-3">
        <div className="text-xs font-semibold uppercase text-slate-500">Reviewer Decision</div>
        <textarea
          value={reviewerComment}
          onChange={(event) => setReviewerComment(event.target.value)}
          rows={2}
          className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          placeholder="Reviewer comment"
        />
        <textarea
          value={overrideReason}
          onChange={(event) => setOverrideReason(event.target.value)}
          rows={2}
          className="mt-2 w-full rounded-md border border-amber-200 px-3 py-2 text-sm"
          placeholder="Override reason required only when overriding the gate"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.values(SAFETY_REMEDIATION_VERIFICATION_DECISIONS).map((decision) => (
            <button
              key={decision}
              type="button"
              disabled={disabled || (!latestRun && decision !== SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE)}
              onClick={() => handleDecision(decision)}
              className={`rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.APPROVE
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.REJECT
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {VERIFICATION_DECISION_LABELS[decision]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
