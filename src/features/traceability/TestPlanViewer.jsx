/**
 * xHandle: test plan viewer traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// src/components/TestPlanViewer.jsx
import React, { useState, useCallback, useEffect } from "react";
import { CKEditor } from "@ckeditor/ckeditor5-react";
import DecoupledEditor from "@ckeditor/ckeditor5-build-decoupled-document";
import ReactDOM from "react-dom";
import { logger } from "../../lib/utils/logger";

/* ---------------- brand / ui ---------------- */
const BRAND = {
  blue: "#2D7DFE",
  blueDim: "#CFE0FF",
  text: "#0B1B4D",
  white: "#FFFFFF",
};

/**
 * Button renders a interactive button surface. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param className Input consumed by this step of the xHandle workflow.
 * @param p Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const Button = ({ className = "", ...p }) => (
    <button
      className={`px-3 py-2 text-sm rounded border bg-white text-gray-900 hover:bg-gray-50 ${className}`}
      {...p}
    />
  );  

/* ---------------- simple Vault (localStorage) ---------------- */
const VAULT_KEY = "xhandle:testplan:vault"; // array of {id,name,updatedAt,plan,documentHtml}
const getVault = () => {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
/**
 * setVault renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param arr Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const setVault = (arr) => {
  localStorage.setItem(VAULT_KEY, JSON.stringify(arr));
};
/**
 * saveRecord renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param rec Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const saveRecord = (rec) => {
  const list = getVault();
  const i = list.findIndex((x) => x.id === rec.id);
  const updated = { ...rec, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = updated; else list.unshift(updated);
  setVault(list);
  return updated;
};
/**
 * getRecord renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const getRecord = (id) => getVault().find((x) => x.id === id);
/**
 * deleteRecord renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const deleteRecord = (id) => setVault(getVault().filter((x) => x.id !== id));

/* ---------------- utils ---------------- */
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : "—");
/**
 * slug renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const slug = (s) =>
  (s || "plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * buildInitialDocFromPlan renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function buildInitialDocFromPlan(plan) {
  if (!plan) return `<h1>AI Test Plan</h1><p>Start writing…</p>`;
  const esc = (s) => String(s ?? "");
  const toList = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join("");

  const strategiesHtml = (plan.strategies || []).map((s) => `
    <h4>${esc(s.kind)}</h4>
    ${s.approach ? `<p><strong>Approach:</strong> ${esc(s.approach)}</p>` : ""}
    ${s.selectionHeuristics?.length ? `<p><strong>Selection:</strong> ${esc(s.selectionHeuristics.join("; "))}</p>` : ""}
    ${s.dataStrategy?.length ? `<p><strong>Data:</strong> ${esc(s.dataStrategy.join("; "))}</p>` : ""}
    ${s.oracleStrategy?.length ? `<p><strong>Oracles:</strong> ${esc(s.oracleStrategy.join("; "))}</p>` : ""}
    ${s.exitCriteria?.length ? `<p><strong>Exit:</strong> ${esc(s.exitCriteria.join("; "))}</p>` : ""}
  `).join("");

  const envHtml = (plan.environments || []).map((e) => `
    <h4>${esc(e.name)}</h4>
    ${e.setup?.length ? `<p><strong>Setup:</strong> ${esc(e.setup.join("; "))}</p>` : ""}
    ${e.data?.length ? `<p><strong>Data:</strong> ${esc(e.data.join("; "))}</p>` : ""}
    ${e.tools?.length ? `<p><strong>Tools:</strong> ${esc(e.tools.join("; "))}</p>` : ""}
    ${e.constraints?.length ? `<p><strong>Constraints:</strong> ${esc(e.constraints.join("; "))}</p>` : ""}
  `).join("");

  const rolesHtml = (plan.roles || []).map((r) => `
    <h4>${esc(r.role)} — ${esc(r.owner)}</h4>
    ${r.responsibilities?.length ? `<ul>${toList(r.responsibilities)}</ul>` : ""}
  `).join("");

  const planItemsHtml = (plan.planItems || []).map((p) => `
    <tr>
      <td>${esc(p.id)}</td>
      <td>${esc(p.title)}</td>
      <td>${esc(p.requirementId || "—")}</td>
      <td>${esc(p.priority ?? "")}</td>
      <td>${esc(p.estimateDays ?? "")}</td>
      <td>${esc((p.dependencies || []).join(", ") || "—")}</td>
      <td>${esc((p.tests || []).slice(0, 6).join(", "))}${(p.tests || []).length > 6 ? " …" : ""}</td>
    </tr>
  `).join("");

  const riskMitHtml = (plan.riskMitigations || []).map((r) => `
    <tr>
      <td>${esc(r.risk)}</td>
      <td>${esc(r.mitigation)}</td>
      <td>${esc(r.owner)}</td>
      <td>${esc(r.due)}</td>
    </tr>
  `).join("");

  const byReqHtml = ((plan.traceability || {}).byRequirement || []).map((r) => `
    <tr>
      <td>${esc(r.requirementId)}</td>
      <td>${esc((r.testIds || []).join(", "))}</td>
    </tr>
  `).join("");

  const cov = (plan.traceability || {}).coverage || {};
  const covReq = cov.requirements?.total
    ? `${cov.requirements.covered || 0} / ${cov.requirements.total} (${Math.round(((cov.requirements.covered || 0) / cov.requirements.total) * 100)}%)`
    : "—";
  const covHaz = cov.hazards?.total
    ? `${cov.hazards.covered || 0} / ${cov.hazards.total} (${Math.round(((cov.hazards.covered || 0) / cov.hazards.total) * 100)}%)`
    : "—";

  return `
    <h1>AI Test Plan — ${esc(plan?.project?.name || "Project")}</h1>
    <p><em>Generated: ${fmtDateTime(plan.generatedAt)}</em></p>

    ${plan.objectives?.length ? `<h2>Objectives</h2><ul>${toList(plan.objectives)}</ul>` : ""}

    ${plan.scope ? `
      <h2>Scope</h2>
      <h3>In Scope</h3>${plan.scope.inScope?.length ? `<ul>${toList(plan.scope.inScope)}</ul>` : "<p>—</p>"}
      <h3>Out of Scope</h3>${plan.scope.outOfScope?.length ? `<ul>${toList(plan.scope.outOfScope)}</ul>` : "<p>—</p>"}
    ` : ""}

    ${strategiesHtml ? `<h2>Strategies</h2>${strategiesHtml}` : ""}

    ${envHtml ? `<h2>Environments</h2>${envHtml}` : ""}

    ${plan.schedule?.milestones?.length ? `
      <h2>Schedule & Milestones</h2>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead><tr><th>Milestone</th><th>Start</th><th>End</th><th>Owner</th><th>Deliverables</th></tr></thead>
        <tbody>
          ${plan.schedule.milestones.map((m) =>
            `<tr><td>${esc(m.name)}</td><td>${esc(m.start)}</td><td>${esc(m.end)}</td><td>${esc(m.owner)}</td><td>${esc((m.deliverables || []).join(", "))}</td></tr>`
          ).join("")}
        </tbody>
      </table>
      ${plan.schedule.cadence ? `<p><em>Cadence:</em> ${
        [plan.schedule.cadence.ci ? "CI" : null, plan.schedule.cadence.nightly ? "Nightly" : null, plan.schedule.cadence.regressionWeekly ? "Weekly Regression" : null]
        .filter(Boolean).join(" • ")
      }</p>` : ""}
    ` : ""}

    ${rolesHtml ? `<h2>Roles & Responsibilities</h2>${rolesHtml}` : ""}

    ${plan.entryExit ? `
      <h2>Entry / Exit Criteria</h2>
      <h3>Entry</h3>${plan.entryExit.entry?.length ? `<ul>${toList(plan.entryExit.entry)}</ul>` : "<p>—</p>"}
      <h3>Exit</h3>${plan.entryExit.exit?.length ? `<ul>${toList(plan.entryExit.exit)}</ul>` : "<p>—</p>"}
    ` : ""}

    ${plan.riskMitigations?.length ? `
      <h2>Risk Mitigations</h2>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead><tr><th>Risk</th><th>Mitigation</th><th>Owner</th><th>Due</th></tr></thead>
        <tbody>${riskMitHtml}</tbody>
      </table>
    ` : ""}

    ${plan.reporting ? `
      <h2>Reporting & Communication</h2>
      ${plan.reporting.metrics?.length ? `<p><strong>Metrics:</strong></p><ul>${toList(plan.reporting.metrics)}</ul>` : ""}
      ${plan.reporting.dashboards?.length ? `<p><strong>Dashboards:</strong></p><ul>${toList(plan.reporting.dashboards)}</ul>` : ""}
      ${plan.reporting.communication?.length ? `<p><strong>Communication:</strong></p><ul>${toList(plan.reporting.communication)}</ul>` : ""}
    ` : ""}

    ${plan.resources ? `
      <h2>Resource Estimate</h2>
      <ul>
        <li><strong>People-days:</strong> ${esc(plan.resources.peopleDays ?? "—")}</li>
        <li><strong>Environments:</strong> ${esc(plan.resources.environments ?? "—")}</li>
        <li><strong>Budget:</strong> ${esc(plan.resources.budgetEstimate ?? "—")}</li>
      </ul>
    ` : ""}

    ${plan.planItems?.length ? `
      <h2>Plan Items (Work Packages)</h2>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead>
          <tr><th>ID</th><th>Title</th><th>Req</th><th>Priority</th><th>Estimate (d)</th><th>Dependencies</th><th>Tests</th></tr>
        </thead>
        <tbody>${planItemsHtml}</tbody>
      </table>
    ` : ""}

    ${plan.traceability ? `
      <h2>Traceability Summary</h2>
      <p><strong>Requirements Coverage:</strong> ${covReq}</p>
      <p><strong>Hazards Coverage:</strong> ${covHaz}</p>
      ${byReqHtml ? `
        <table border="1" cellspacing="0" cellpadding="6">
          <thead><tr><th>Requirement</th><th>Tests</th></tr></thead>
          <tbody>${byReqHtml}</tbody>
        </table>` : ""}
    ` : ""}

    ${plan.assumptions?.length ? `<h2>Assumptions</h2><ul>${toList(plan.assumptions)}</ul>` : ""}
    ${plan.notes?.length ? `<h2>Notes</h2><ul>${toList(plan.notes)}</ul>` : ""}
  `;
}

/* ------------ Docs-like rich editor ------------ */
function RichDocEditor({ valueHtml, onChangeHtml }) {
  return (
    <div className="border rounded-b-2xl overflow-hidden">
      <div id="ck-toolbar" className="sticky top-0 z-10 bg-white border-b px-2 py-1" />
      <div className="bg-gray-100 max-h-[66vh] overflow-auto py-6 flex justify-center">
        <div className="bg-white w-[816px] min-h-[1056px] shadow-xl border border-gray-100 p-[96px]">
          <CKEditor
            editor={DecoupledEditor}
            data={valueHtml || ""}
            onReady={(editor) => {
              const toolbarHost = document.getElementById("ck-toolbar");
              if (toolbarHost) {
                toolbarHost.innerHTML = "";
                toolbarHost.appendChild(editor.ui.view.toolbar.element);
              }
              editor.ui.view.toolbar.element.style.width = "100%";
            }}
            onChange={(_, editor) => onChangeHtml?.(editor.getData())}
            config={{
              placeholder: "Start writing or paste your autogenerated plan…",
              toolbar: {
                items: [
                  "undo","redo","|",
                  "heading","|",
                  "fontSize","bold","italic","underline","link","|",
                  "bulletedList","numberedList","todoList","|",
                  "alignment","outdent","indent","|",
                  "blockQuote","insertTable","horizontalLine","|",
                  "removeFormat"
                ],
              },
              table: { contentToolbar: ["tableColumn","tableRow","mergeTableCells"] },
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------- File System Access helpers ---------------- */
const hasFSAccess = () => "showDirectoryPicker" in window;
/**
 * saveJsonToDirectory renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param dirHandle Input consumed by this step of the xHandle workflow.
 * @param filename Input consumed by this step of the xHandle workflow.
 * @param json Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
async function saveJsonToDirectory(dirHandle, filename, json) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(json, null, 2));
  await writable.close();
}

/* ---------------- main viewer ---------------- */
export default function TestPlanViewer({
  plan,
  onClose,
  onExportJSON,
  onExportMD,
  onSaveDocument, // (html) => void (optional external hook)
  onExportDOCX,   // (html) => void
  onExportPDF,    // (html) => void
  onExportHTML,   // (html) => void
}) {
  const [mode, setMode] = useState("summary");
  const [docHtml, setDocHtml] = useState(() =>
    plan?.documentHtml || buildInitialDocFromPlan(plan)
  );
  const [dirHandle, setDirHandle] = useState(null);
  const [openVault, setOpenVault] = useState(false);

  useEffect(() => {
    setDocHtml(plan?.documentHtml || buildInitialDocFromPlan(plan));
  }, [plan]);

  const hasPlan = !!plan;

  /* ---------- Save (Vault) ---------- */
  const handleSaveToVault = useCallback(() => {
    if (!hasPlan) return;
    const rec = {
      id: plan.id || `${slug(plan?.project?.name)}-${Date.now()}`,
      name: plan?.project?.name || "Project",
      plan: { ...plan, documentHtml: docHtml },
      documentHtml: docHtml,
    };
    const saved = saveRecord(rec);
    if (onSaveDocument) onSaveDocument(docHtml);
    toastMini(`Saved to Vault: ${saved.name}`);
  }, [hasPlan, plan, docHtml, onSaveDocument]);

  /* ---------- Open (Vault) ---------- */
  const loadFromVault = (id) => {
    const rec = getRecord(id);
    if (!rec) return;
    setDocHtml(rec.documentHtml || buildInitialDocFromPlan(rec.plan));
    toastMini(`Opened: ${rec.name}`);
    setOpenVault(false);
  };

  /* ---------- Save to Folder (local disk) ---------- */
  const handleSaveToFolder = useCallback(async () => {
    if (!hasPlan) return;
    const payload = { ...plan, documentHtml: docHtml };
    const filename = `${slug(plan?.project?.name || "test-plan")}.json`;

    if (!hasFSAccess()) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toastMini("Downloaded plan JSON");
      return;
    }

    try {
      let dir = dirHandle;
      if (!dir) {
        dir = await window.showDirectoryPicker({ id: "xhandle-testplans" });
        setDirHandle(dir);
      }
      await saveJsonToDirectory(dir, filename, payload);
      toastMini(`Saved to folder as ${filename}`);
    } catch (e) {
      logger.warn(e);
      toastMini("Save canceled or failed");
    }
  }, [hasPlan, plan, docHtml, dirHandle]);

  /* ---------- Tiny inline toast ---------- */
  const [toastMsg, setToastMsg] = useState("");
  const toastMini = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 1800);
  };

  const headerButton = (key, label) => (
    <button
      key={key}
      className={`px-3 py-1.5 rounded-full text-sm ${mode === key ? "bg-white text-black" : "text-white/90 hover:text-white"}`}
      onClick={() => setMode(key)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[min(96vw,1080px)] max-w-[1080px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 md:px-6 py-3 text-white flex items-center justify-between gap-3" style={{ background: BRAND.blue }}>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">AI Test Plan — {plan?.project?.name || "Project"}</div>
            <div className="ml-3 text-xs text-white/80">Generated {fmtDateTime(plan?.generatedAt)}</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/10 rounded-full p-1">
              {headerButton("summary", "Summary")}
              {headerButton("document", "Document")}
            </div>

            {mode === "summary" && (
              <>
                <Button onClick={onExportJSON} disabled={!hasPlan}>Export JSON</Button>
                <Button onClick={onExportMD} disabled={!hasPlan}>Export Markdown</Button>
              </>
            )}

            {mode === "document" && (
              <>
                <Button onClick={handleSaveToVault} title="Save inside app (Vault)">Save</Button>
                <Button onClick={() => setOpenVault(true)} title="Open from Vault">Open…</Button>
                <Button onClick={handleSaveToFolder} title="Save JSON to a folder">Save to Folder</Button>
                {onExportHTML && <Button onClick={() => onExportHTML(docHtml)}>Export HTML</Button>}
                {onExportDOCX && <Button onClick={() => onExportDOCX(docHtml)}>Export DOCX</Button>}
                {onExportPDF && <Button onClick={() => onExportPDF(docHtml)}>Export PDF</Button>}
              </>
            )}

            <button
              onClick={onClose}
              className="text-white/90 hover:text-white text-xl leading-none"
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tiny toast */}
        {!!toastMsg && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-1 rounded-full">
            {toastMsg}
          </div>
        )}

        {/* Body */}
        {mode === "summary" ? (
          <div className="p-6 space-y-6 text-sm max-h-[80vh] overflow-auto">
            {!hasPlan ? (
              <div className="text-gray-500">No plan loaded.</div>
            ) : (
              <>
                <section>
                  <div className="text-gray-500">Generated</div>
                  <div>{fmtDateTime(plan.generatedAt)}</div>
                </section>

                <Section title="Objectives" items={plan.objectives} />
                <Scope scope={plan.scope} />
                <Strategies strategies={plan.strategies} />
                <Environments environments={plan.environments} />
                <Schedule schedule={plan.schedule} />
                <Roles roles={plan.roles} />
                <EntryExit entryExit={plan.entryExit} />
                <RiskMitigations items={plan.riskMitigations} />
                <Reporting reporting={plan.reporting} />
                <Resources resources={plan.resources} />
                <PlanItems items={plan.planItems} />
                <Traceability traceability={plan.traceability} />
                <Section title="Assumptions" items={plan.assumptions} />
                <Section title="Notes" items={plan.notes} />
              </>
            )}
          </div>
        ) : (
          <div className="max-h-[80vh] overflow-hidden">
            <RichDocEditor valueHtml={docHtml} onChangeHtml={setDocHtml} />
          </div>
        )}

        {/* Vault modal */}
        {openVault && (
          <VaultModal onClose={() => setOpenVault(false)} onOpen={loadFromVault} onDelete={deleteRecord} />
        )}
      </div>
    </div>
  );
}

/* ------------------ Reusable button for your toolbar ------------------ */
/** Place this next to your "Generate Test Plan" button */
export function OpenPlansButton({ className = "", onSelect }) {
  const [open, setOpen] = useState(false);

  const handleOpen = (id) => {
    const rec = getRecord(id);
    if (rec && onSelect) onSelect(rec); // rec = { id, name, plan, documentHtml, updatedAt }
    setOpen(false);
  };

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} title="Browse saved test plans">
        Open Plans…
      </Button>
      {open && (
        <VaultModal
          onClose={() => setOpen(false)}
          onOpen={handleOpen}
          onDelete={deleteRecord}
        />
      )}
    </>
  );
}

/* --------- summary view components (unchanged) --------- */
function Section({ title, items }) {
  if (!items?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <ul className="list-disc ml-6 space-y-1">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </section>
  );
}

/**
 * Scope renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param scope Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Scope({ scope }) {
  if (!scope) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Scope</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="In Scope" list={scope.inScope} />
        <Card title="Out of Scope" list={scope.outOfScope} />
      </div>
    </section>
  );
}

/**
 * Strategies renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param strategies Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Strategies({ strategies }) {
  if (!strategies?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Strategies</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {strategies.map((s, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="font-medium">{s.kind}</div>
            {s.approach && <Row label="Approach" value={s.approach} />}
            <RowList label="Selection" list={s.selectionHeuristics} />
            <RowList label="Data" list={s.dataStrategy} />
            <RowList label="Oracles" list={s.oracleStrategy} />
            <RowList label="Exit" list={s.exitCriteria} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Environments renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param environments Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Environments({ environments }) {
  if (!environments?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Environments</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {environments.map((e, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="font-medium">{e.name}</div>
            <RowList label="Setup" list={e.setup} />
            <RowList label="Data" list={e.data} />
            <RowList label="Tools" list={e.tools} />
            <RowList label="Constraints" list={e.constraints} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Schedule renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param schedule Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Schedule({ schedule }) {
  if (!schedule) return null;
  const ms = schedule.milestones || [];
  const cad = schedule.cadence || {};
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Schedule & Milestones</h3>
      {!!ms.length && (
        <div className="rounded-lg border overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Milestone", "Start", "End", "Owner", "Deliverables"].map((h) => (
                  <th key={h} className="px-3 py-2 border-b text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ms.map((m, i) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2 border-b">{m.name}</td>
                  <td className="px-3 py-2 border-b">{m.start}</td>
                  <td className="px-3 py-2 border-b">{m.end}</td>
                  <td className="px-3 py-2 border-b">{m.owner}</td>
                  <td className="px-3 py-2 border-b">{(m.deliverables || []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-gray-600 mt-2">
        Cadence: {[
          cad.ci ? "CI" : null,
          cad.nightly ? "Nightly" : null,
          cad.regressionWeekly ? "Weekly Regression" : null,
        ].filter(Boolean).join(" • ")}
      </div>
    </section>
  );
}

/**
 * Roles renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param roles Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Roles({ roles }) {
  if (!roles?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Roles & Responsibilities</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {roles.map((r, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="font-medium">{r.role} — {r.owner}</div>
            <ul className="list-disc ml-6 mt-1">
              {(r.responsibilities || []).map((x, j) => <li key={j}>{x}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * EntryExit renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param entryExit Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function EntryExit({ entryExit }) {
  if (!entryExit) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Entry / Exit Criteria</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Entry" list={entryExit.entry} />
        <Card title="Exit" list={entryExit.exit} />
      </div>
    </section>
  );
}

/**
 * RiskMitigations renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param items Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function RiskMitigations({ items }) {
  if (!items?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Risk Mitigations</h3>
      <div className="rounded-lg border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["Risk", "Mitigation", "Owner", "Due"].map((h) => (
                <th key={h} className="px-3 py-2 border-b text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 border-b">{r.risk}</td>
                <td className="px-3 py-2 border-b">{r.mitigation}</td>
                <td className="px-3 py-2 border-b">{r.owner}</td>
                <td className="px-3 py-2 border-b">{r.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Reporting renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param reporting Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Reporting({ reporting }) {
  if (!reporting) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Reporting & Communication</h3>
      <div className="rounded-lg border p-3">
        {reporting.metrics?.length && (
          <>
            <div className="text-gray-500">Metrics</div>
            <ul className="list-disc ml-6">
              {reporting.metrics.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </>
        )}
        {reporting.dashboards?.length && (
          <>
            <div className="text-gray-500 mt-3">Dashboards</div>
            <ul className="list-disc ml-6">
              {reporting.dashboards.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </>
        )}
        {reporting.communication?.length && (
          <>
            <div className="text-gray-500 mt-3">Communication</div>
            <ul className="list-disc ml-6">
              {reporting.communication.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Resources renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param resources Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Resources({ resources }) {
  if (!resources) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Resource Estimate</h3>
      <div className="rounded-lg border p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Metric label="People-days" value={resources.peopleDays} />
        <Metric label="Environments" value={resources.environments} />
        <Metric label="Budget" value={resources.budgetEstimate} />
      </div>
    </section>
  );
}

/**
 * PlanItems renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param items Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function PlanItems({ items }) {
  if (!items?.length) return null;
  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Plan Items (Work Packages)</h3>
      <div className="rounded-lg border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["ID","Title","Req","Priority","Estimate (d)","Dependencies","Tests"].map((h)=>(
                <th key={h} className="px-3 py-2 border-b text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((p, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                <td className="px-3 py-2 border-b font-mono text-xs">{p.id}</td>
                <td className="px-3 py-2 border-b">{p.title}</td>
                <td className="px-3 py-2 border-b">{p.requirementId || "—"}</td>
                <td className="px-3 py-2 border-b">{p.priority}</td>
                <td className="px-3 py-2 border-b">{p.estimateDays}</td>
                <td className="px-3 py-2 border-b">{(p.dependencies || []).join(", ") || "—"}</td>
                <td className="px-3 py-2 border-b">{(p.tests || []).slice(0, 6).join(", ")}{(p.tests || []).length > 6 ? " …" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Traceability renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param traceability Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Traceability({ traceability }) {
  if (!traceability) return null;
  const cov = traceability.coverage || {};
  const byReq = traceability.byRequirement || [];
  const pct = (c) => c.total ? Math.round(((c.covered || 0) / c.total) * 100) : 0;

  return (
    <section>
      <h3 className="text-base font-semibold mb-2">Traceability Summary</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <Card title="Requirements Coverage" list={[
          `${cov.requirements?.covered || 0} / ${cov.requirements?.total || 0} (${pct(cov.requirements || {})}%)`
        ]} />
        <Card title="Hazards Coverage" list={[
          `${cov.hazards?.covered || 0} / ${cov.hazards?.total || 0} (${pct(cov.hazards || {})}%)`
        ]} />
      </div>

      {!!byReq.length && (
        <div className="rounded-lg border overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Requirement","Tests"].map((h)=>(
                  <th key={h} className="px-3 py-2 border-b text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byReq.map((r, i) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  <td className="px-3 py-2 border-b">{r.requirementId}</td>
                  <td className="px-3 py-2 border-b">{(r.testIds || []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Card renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param list Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Card({ title, list }) {
  if (!list?.length) return null;
  return (
    <div className="rounded-lg border p-3">
      <div className="text-gray-500 mb-1">{title}</div>
      <ul className="list-disc ml-6">
        {list.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

/**
 * Row renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="text-sm"><span className="text-gray-500">{label}:</span> {value}</div>
  );
}

/**
 * RowList renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param list Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function RowList({ label, list }) {
  if (!list?.length) return null;
  return (
    <div className="text-sm">
      <span className="text-gray-500">{label}:</span> {(list || []).join("; ")}
    </div>
  );
}

/**
 * Metric renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param value Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Metric({ label, value }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value ?? "—"}</div>
    </div>
  );
}

/* ---------------- Vault Modal ---------------- */
/* ---------------- Vault Modal ---------------- */
function VaultModal({ onClose, onOpen, onDelete }) {
    const items = getVault();
  
    const el = (
      <div
        className="fixed inset-0 z-[100000] bg-black/40 flex items-center justify-center"
        onClick={onClose}
      >
        <div
          className="bg-white w-[min(92vw,700px)] max-h-[70vh] overflow-auto rounded-xl border shadow-2xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-semibold">Saved Plans (Vault)</div>
            <button className="text-xl" onClick={onClose} aria-label="Close">×</button>
          </div>
          {items.length === 0 ? (
            <div className="text-sm text-gray-500">
              No saved plans yet. Use “Save” in the Document tab.
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 border-b">Name</th>
                  <th className="text-left px-3 py-2 border-b">Updated</th>
                  <th className="px-3 py-2 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 border-b">{x.name}</td>
                    <td className="px-3 py-2 border-b">{fmtDateTime(x.updatedAt)}</td>
                    <td className="px-3 py-2 border-b text-right">
                      <Button onClick={() => onOpen(x.id)} className="mr-2">Open</Button>
                      <Button onClick={() => onDelete(x.id)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  
    // Render above everything else
    return ReactDOM.createPortal(el, document.body);
  }
  
