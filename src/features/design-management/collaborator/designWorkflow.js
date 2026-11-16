// Application-owned workflow facts. Acceptance, object approval and a chat
// edit proposal are separate operations; model prose cannot create controls.
export function artifactWorkflow(data) {
  if (data.meta.templateId === 'traceability-matrix') return { scope: 'saved traceability assessment', proposalState: 'none', proposalReady: false, controls: ['Matrix actions', 'Refresh Traceability', 'Select sources', 'Save assessment revision'], controlsLocation: 'Open Matrix actions (⋯). Relationship editing is available in the advanced views.', acceptanceEffect: 'Pins the assessed profile, source identities, relationships and findings. Does not approve requirements or claim a passing test.', collaboratorEdits: 'Saved assessment results are read-only. Explain candidate relationships and rationale; users review them with Add relationship. Never rewrite assessment rows as engineering evidence.' };
  const ready = data.job?.state === 'ready';
  return {
    scope: data.target.draft ? 'draft' : 'accepted revision',
    proposalState: data.job?.state || 'none',
    proposalReady: ready,
    controls: data.meta.programId
      ? ['Artifact actions', 'Review project and traceability']
      : ready ? ['Review proposal', 'Accept proposal']
        : data.job ? ['Artifact actions', 'Generate / resume draft'] : ['Artifact actions', 'Generate update'],
    projectManaged: !!data.meta.programId,
    controlsLocation: 'Open Artifact actions (⋯). Review proposal opens the Document proposal review dialog, with coverage, comparison and acceptance controls. Generation and sources, Export, and Objects and history hold secondary actions. Project-wide generation and acceptance are under Project actions (⋯).',
    acceptanceEffect: 'Creates a document revision; preserves object statuses and review flags. Does not lock objects or approve engineering claims.',
    objectApproval: 'Edit the object Status and Save object, or request an explicit status-change proposal in Collaborator.',
    collaboratorEdits: 'Only a validated change proposal displays Apply changes and Cancel. Apply changes saves the reviewed edits to its exact draft or revision; it does not accept a generated document proposal.',
  };
}

export function isMissingApplyQuestion(text) {
  const value = String(text || '').trim();
  return value.length < 400 && /\bapply\b/i.test(value) && /\bbutton\b/i.test(value)
    && /\b(?:where|cannot|can't|can’t|missing|no|don'?t\s+see|don’t\s+see|do\s+not\s+see|how\s+(?:do|can))\b/i.test(value);
}

export function applyHelp(workflow, hasPendingProposal = false) {
  const lines = [hasPendingProposal
    ? 'The **Apply changes** button is below the before/after values in the pending **Proposed workspace changes** card in this conversation. Review those edits, then apply or cancel them.'
    : 'There is no pending Collaborator change proposal for this document, so there is no **Apply changes** button. A text-only suggestion does not change saved content. Ask me to make the specific edits and I can prepare a before/after proposal with **Apply changes** and **Cancel**.'];
  if (workflow?.projectManaged) lines.push('To accept the generated document, open **Artifact actions (⋯)** → **Review project and traceability**. Project documents are accepted together in their systems engineering project.');
  else if (workflow?.proposalReady) lines.push('For the generated document, open **Artifact actions (⋯)** → **Review proposal**, then choose **Accept proposal** in the **Document proposal review** dialog. Accepting creates a document revision and preserves the individual object statuses and review flags.');
  else if (workflow?.proposalState && workflow.proposalState !== 'none') lines.push('The generated draft is incomplete. Use **Artifact actions (⋯)** → **Generate / resume draft** to finish it before accepting.');
  lines.push('To mark an individual requirement Approved, edit its **Status** and choose **Save object**, or request a status-change proposal. Applying edits and accepting a document do not automatically approve requirements or lock them.');
  return lines.join('\n\n');
}

export function assertDesignAnswerControls(text, { hasPendingProposal = false, mutationRequested = false } = {}) {
  const plain = String(text || '').replace(/[*_`]/g, '');
  const applyInstruction = /\b(?:click|press|use|select|choose|hit|locate|find)\b[^.!?\n]{0,180}\bapply(?:\s+changes)?\b[^.!?\n]{0,70}\b(?:button|review\s+(?:panel|card))\b/i.test(plain);
  const sentenceClaims = plain.split(/(?<=[.!?])\s+|\n/).some(sentence => {
    if (/\b(?:does not|do not|will not|doesn't|won't|not automatically)\b/i.test(sentence)) return false;
    return /\b(?:will|automatically)\b[^.!?]{0,140}\block\b[^.!?]{0,100}\bedit/i.test(sentence)
      || /\b(?:apply(?:ing| changes)?|accept(?:ing| proposal)?)\b[^.!?]{0,120}\b(?:mark|move|set)\b[^.!?]{0,80}\bapproved\b/i.test(sentence);
  });
  const falseProposal = mutationRequested && /\b(?:I(?:'ve| have)?|we(?:'ve| have)?)\s+(?:already\s+)?(?:saved|applied|updated|approved|changed|prepared)\b/i.test(plain);
  if ((!hasPendingProposal && applyInstruction) || sentenceClaims || falseProposal) {
    const error = Error('A text-only answer has no Apply changes control and cannot claim saved edits. For requested edits, return kind propose with exact actions; otherwise explain the actual workflow. Accept proposal creates a revision, preserves object statuses/review flags, and does not lock objects.');
    error.code = 'DESIGN_CONTROLS';
    throw error;
  }
}
