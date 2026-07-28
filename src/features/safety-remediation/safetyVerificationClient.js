const VSCODE_VERIFICATION_BASE_URL = "http://127.0.0.1:39017/verification";

async function getJson(path) {
  let response;
  try {
    response = await fetch(`${VSCODE_VERIFICATION_BASE_URL}${path}`);
  } catch (error) {
    throw new Error(`VS Code verification endpoint is unavailable. Open VS Code with the xHandle Safety extension, then try again. ${error?.message || ""}`.trim());
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `VS Code verification request failed (${response.status}).`);
  }
  return body;
}

async function postJson(path, payload = {}) {
  let response;
  try {
    response = await fetch(`${VSCODE_VERIFICATION_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`VS Code verification endpoint is unavailable. Open VS Code with the xHandle Safety extension, then try again. ${error?.message || ""}`.trim());
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `VS Code verification request failed (${response.status}).`);
  }
  return body;
}

export async function detectVerificationCommands({ finding, patchProposal, handoff } = {}) {
  return postJson("/detect-commands", {
    remediationId: finding?.id || "",
    safetyFindingId: finding?.id || "",
    patchProposalId: patchProposal?.id || "",
    handoff,
  });
}

export async function runVerificationCommands({ finding, patchProposal, commands = [], handoff } = {}) {
  return postJson("/run-commands", {
    remediationId: finding?.id || "",
    safetyFindingId: finding?.id || "",
    patchProposalId: patchProposal?.id || "",
    commands,
    handoff,
  });
}

export async function proposeVerificationRepairs({ finding, patchProposal, run } = {}) {
  return postJson("/propose-repairs", {
    remediationId: finding?.id || "",
    safetyFindingId: finding?.id || "",
    patchProposalId: patchProposal?.id || "",
    run,
  });
}

export async function getVerificationStatus() {
  return getJson("/status");
}
