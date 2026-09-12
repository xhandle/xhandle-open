import React, { useEffect, useState } from "react";
import {
  Bot,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  ShieldAlert,
  Workflow,
  X,
} from "lucide-react";

const logoSrc = `${process.env.PUBLIC_URL || ""}/xHandle_Logo.PNG`;

const guideSections = [
  { id: "guide-quick-start", label: "Quick Start", icon: Rocket },
  { id: "guide-code-architecture", label: "Code-Based Architecture", icon: GitBranch },
  { id: "guide-review-app", label: "Generate Review App", icon: Download },
  { id: "guide-assurance", label: "Assurance and Results Review", icon: ClipboardCheck },
  { id: "guide-hazard-analysis", label: "Hazard Analysis and Safety Remediation", icon: ShieldAlert },
  { id: "guide-traceability", label: "Traceability, Requirements, and V&V", icon: Network },
  { id: "guide-workspaces", label: "Project and Cross-Repo Workspaces", icon: Workflow },
  { id: "guide-collaborator", label: "Collaborator", icon: Bot },
  { id: "guide-prompt-cookbook", label: "Prompt Cookbook", icon: Bot },
  { id: "guide-local-data", label: "Local-First Data Model", icon: Database },
];

function Section({ id, icon: Icon, title, eyebrow, children }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 ring-1 ring-slate-200">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          {eyebrow && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {eyebrow}
            </div>
          )}
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        </div>
      </div>
      <div className="px-5 py-5 text-sm leading-7 text-slate-800">
        {children}
      </div>
    </section>
  );
}

function BulletList({ items }) {
  return (
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={idx} className="flex gap-3">
          <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StepList({ steps }) {
  return (
    <div className="space-y-3">
      {steps.map((step, idx) => (
        <div key={idx} className="flex gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white">
            {idx + 1}
          </div>
          <div className="text-sm leading-6 text-slate-800">{step}</div>
        </div>
      ))}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="mb-2 mr-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800">
      {children}
    </span>
  );
}

function FeatureGrid({ features }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {features.map(({ title, text }) => (
        <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-1 text-sm font-semibold text-slate-950">{title}</div>
          <p className="text-sm leading-6 text-slate-700">{text}</p>
        </div>
      ))}
    </div>
  );
}

function PromptExample({ title, description, prompt }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      {description && <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>}
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-800">
        <code>{prompt}</code>
      </pre>
    </div>
  );
}

export default function ReadmeModal({ open, onClose }) {
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="xhandle-modal-viewport fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-10 flex h-[92vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-100 shadow-2xl">
        <div className="sticky top-0 z-20 border-b border-slate-300 bg-white">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                <img src={logoSrc} className="max-h-8 max-w-9 object-contain" alt="xHandle" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-950">xHandle Guide</div>
                <div className="text-sm font-medium text-slate-600">
                  Local-first systems engineering, architecture review, safety analysis, and verification
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              aria-label="Close guide"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-t border-slate-200 px-6 py-3">
            <Pill>Local-only</Pill>
            <Pill>Code architecture</Pill>
            <Pill>Review apps</Pill>
            <Pill>Hazards and remediation</Pill>
            <Pill>Requirements and V&V</Pill>
            <Pill>OpenAI, Claude, Gemini</Pill>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside
            className={`${navigationCollapsed ? "w-14" : "w-64"} flex shrink-0 flex-col border-r border-slate-300 bg-white transition-[width] duration-200 ease-out`}
          >
            <div className={`flex h-12 shrink-0 items-center border-b border-slate-200 ${navigationCollapsed ? "justify-center" : "justify-between px-3"}`}>
              {!navigationCollapsed && (
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Guide sections</span>
              )}
              <button
                type="button"
                onClick={() => setNavigationCollapsed((collapsed) => !collapsed)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                aria-label={navigationCollapsed ? "Expand guide navigation" : "Collapse guide navigation"}
                aria-expanded={!navigationCollapsed}
                title={navigationCollapsed ? "Expand guide navigation" : "Collapse guide navigation"}
              >
                {navigationCollapsed
                  ? <PanelLeftOpen className="h-4 w-4" />
                  : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Guide sections">
              <ul className="space-y-1">
                {guideSections.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      title={navigationCollapsed ? label : undefined}
                      className={`${navigationCollapsed ? "justify-center px-0" : "px-2.5"} flex min-h-9 items-center gap-2 rounded-md text-xs font-medium text-slate-700 transition hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!navigationCollapsed && <span>{label}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="rounded-lg border border-slate-300 bg-white px-6 py-7 shadow-sm">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Build, review, and assure engineering data locally</h1>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
                    xHandle connects functional architecture, code decomposition, hazard analysis, risk,
                    requirements, traceability, safety remediation, and verification planning in one local workspace.
                    Your app data stays on this machine unless you explicitly send selected context to your chosen AI provider.
                  </p>
                </div>
                <div className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
                  No Supabase, hosted auth, telemetry, billing gates, or cloud persistence.
                </div>
              </div>
            </div>

            <Section id="guide-quick-start" icon={Rocket} title="Quick Start" eyebrow="First path">
              <StepList
                steps={[
                  "Open Settings, add your AI provider key, and choose OpenAI, Claude, or Gemini as the active provider.",
                  "Start with a GitHub repository for code-based architecture, or create a project manually or with AI-assisted prompts.",
                  "Generate or edit the functional decomposition table, then use the diagram and table views to inspect relationships.",
                  "Use the review workspace, assurance artifacts, hazard analysis, remediation, requirements, traceability, and V&V views to deepen the engineering record.",
                ]}
              />
            </Section>

            <Section id="guide-code-architecture" icon={GitBranch} title="Code-Based Architecture" eyebrow="Repository analysis">
              <p className="mb-4">
                The code architecture workflow turns selected GitHub files into a functional decomposition table and
                interactive architecture diagram.
              </p>
              <BulletList
                items={[
                  "Analyze public repositories directly, or add a GitHub token in Settings for private repositories and higher rate limits.",
                  "Use README and repository context to improve system understanding before file chunks are sent to the selected AI provider.",
                  "Review generated rows, classifications, confidence, evidence, source files, functions, and relationships.",
                  "Switch between table and diagram views, edit rows, filter views, and preserve manual diagram positioning locally.",
                  "Create focused subprojects from selected diagram nodes when a subset deserves deeper analysis.",
                ]}
              />
            </Section>

            <Section id="guide-review-app" icon={Download} title="Generate Review App" eyebrow="Portable review artifact">
              <p className="mb-4">
                After a code-based architecture table exists, use Generate Review App to create a downloadable,
                read-only Electron app for architecture review.
              </p>
              <FeatureGrid
                features={[
                  {
                    title: "Selectable scope",
                    text: "Choose one or more architecture projects or cross-repo targets and include the analysis sections that are ready.",
                  },
                  {
                    title: "Local packaging",
                    text: "The local API server builds the review-mode React app, wraps it with Electron Builder, and writes a zip locally.",
                  },
                  {
                    title: "Review-ready data",
                    text: "The package can include architecture rows, diagram positions, assurance artifacts, hazard runs, remediation context, and review items.",
                  },
                  {
                    title: "No hosted packager",
                    text: "The open-source flow does not call Supabase, cloud storage, hosted review services, signing services, or billing systems.",
                  },
                ]}
              />
            </Section>

            <Section id="guide-assurance" icon={ClipboardCheck} title="Assurance and Results Review" eyebrow="Review workspace">
              <BulletList
                items={[
                  "Use the assurance workspace after architecture generation to create and review engineering artifacts.",
                  "Manage software requirements, system requirements, subsystem requirements, design elements, and traceability views.",
                  "Use review statuses and review scaffolding to separate draft AI output from reviewed engineering decisions.",
                  "Export architecture review data for offline review through the local review app flow.",
                ]}
              />
            </Section>

            <Section id="guide-hazard-analysis" icon={ShieldAlert} title="Hazard Analysis and Safety Remediation" eyebrow="Safety workflow">
              <div className="mb-4">
                <Pill>STPA</Pill>
                <Pill>FMEA</Pill>
                <Pill>What-If</Pill>
                <Pill>HARA/FHA</Pill>
                <Pill>STPA-Sec</Pill>
                <Pill>Code-hazard review</Pill>
              </div>
              <BulletList
                items={[
                  "Generate hazards, unsafe control actions, causal factors, mitigations, and risk-oriented outputs from functional architecture.",
                  "Review safety findings with source context, impacted files, patch proposals, review decisions, and verification evidence.",
                  "Use lightweight verification scaffolding to record commands, outcomes, evidence, and remaining safety work.",
                  "Keep findings and remediation state locally while using AI only when you choose to generate or refine analysis.",
                ]}
              />
            </Section>

            <Section id="guide-traceability" icon={Network} title="Traceability, Requirements, and V&V" eyebrow="Connected artifacts">
              <FeatureGrid
                features={[
                  {
                    title: "Requirements management",
                    text: "Create, edit, organize, and derive requirements from architecture and hazard outputs.",
                  },
                  {
                    title: "Traceability",
                    text: "Connect functions, hazards, risks, mitigations, requirements, design elements, and verification targets.",
                  },
                  {
                    title: "V&V planning",
                    text: "Generate and manage test cases, verification activities, evidence, and document-style review artifacts.",
                  },
                  {
                    title: "Risk register",
                    text: "Track risk context, ownership, status, priority, mitigation progress, and project-level posture.",
                  },
                ]}
              />
            </Section>

            <Section id="guide-workspaces" icon={Workflow} title="Project and Cross-Repo Workspaces" eyebrow="Larger systems">
              <BulletList
                items={[
                  "Organize architecture projects and folders in the left sidebar.",
                  "Use cross-repo architecture views to inspect interfaces and relationships across multiple repositories.",
                  "Carry assurance artifacts and traceability context into folder-level review packages.",
                  "Use local storage and local backups to keep the workspace portable without cloud persistence.",
                ]}
              />
            </Section>

            <Section id="guide-collaborator" icon={Bot} title="Collaborator" eyebrow="AI assistance">
              <BulletList
                items={[
                  "Ask questions about the current workspace, selected artifacts, architecture rows, hazards, risks, requirements, and remediation context.",
                  "Generate new functional architectures or review, revise, and edit the functional decomposition in the active project.",
                  "Vibe review a functional decomposition one interface at a time, accepting a Keep, Revise, or Remove proposal or deferring the row.",
                  "Start a governed hazard Vibe Review to examine a stable queue one row at a time and apply explicit reviewer decisions.",
                  "Use your own provider keys through the local API server; supported providers are OpenAI, Claude, and Gemini.",
                  "Provider errors, quotas, and billing come from the provider account you configure. xHandle does not include hosted billing or paid gates.",
                  "For sensitive work, review prompts and generated outputs before treating them as engineering evidence.",
                ]}
              />
            </Section>

            <Section id="guide-prompt-cookbook" icon={Bot} title="Collaborator Prompt Cookbook" eyebrow="Example prompts">
              <p className="mb-4">
                Open the relevant project and tab before using project-specific prompts. Replace names and bracketed
                instructions with your own engineering context. Proposed architecture changes remain reviewable before
                they are applied.
              </p>

              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Create and understand functional architecture
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <PromptExample
                  title="Generate a new decomposition"
                  description="Naming the abstraction level avoids an additional selection step."
                  prompt="Create a multi-level functional decomposition for an autonomous warehouse robot that retrieves totes in shared pedestrian aisles."
                />
                <PromptExample
                  title="Inspect one subsystem"
                  description="Returns the functions and interfaces already present in the active project."
                  prompt="Show the functions and interfaces allocated to the Perception subsystem in the current project."
                />
                <PromptExample
                  title="Check graph connectivity"
                  description="Inspects the existing decomposition without changing it."
                  prompt="Check the current functional decomposition for orphan node pairs, isolated functions, and disconnected graph islands."
                />
                <PromptExample
                  title="Propose connections for orphan pairs"
                  description="Creates reviewable bridging rows; say “add them” only after checking the proposal."
                  prompt="Find orphan node pairs in the current functional decomposition and propose interface rows that connect them to the main functional graph."
                />
              </div>

              <div className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Review and revise the active decomposition
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <PromptExample
                  title="Run an additive completeness audit"
                  description="Looks for missing coverage while preserving every existing row."
                  prompt="Audit the current functional decomposition for missing operational, feedback, health, mode, and fault-management interfaces. Preserve every existing row and propose additions only."
                />
                <PromptExample
                  title="Revise from engineering feedback"
                  description="Produces targeted additions, updates, and removals for review."
                  prompt="Revise the current functional decomposition based on this feedback: [describe the specific problem and desired correction]. Preserve sound unrelated rows and prepare targeted changes for review."
                />
                <PromptExample
                  title="Reevaluate subsystem ownership"
                  description="Reviews allocation without rewriting the interfaces."
                  prompt="Reevaluate the subsystem allocation for every existing functional decomposition row. Do not add, remove, or rewrite interfaces."
                />
                <PromptExample
                  title="Request an explicit table edit"
                  description="Use exact function and payload names whenever possible."
                  prompt="Add a feedback interface from Monitor Brake Status to Determine Braking Availability carrying Secondary Brake Health Status. Preserve unrelated rows."
                />
                <PromptExample
                  title="Vibe review each interface"
                  description="Walks a stable queue one row at a time and proposes Keep, Revise, Remove, or Needs Input."
                  prompt="Vibe review the current functional decomposition one interface at a time. Check leaf-function endpoints, subsystem ownership, direction, interface semantics, and details."
                />
                <PromptExample
                  title="Vibe review one subsystem"
                  description="Limits the queue to an exact subsystem name."
                  prompt="Vibe review functional-decomposition rows in subsystem Perception & World Modeling one interface at a time."
                />
              </div>

              <div className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Review hazard-analysis results
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <PromptExample
                  title="Vibe Review Needs Review rows"
                  description="Creates a stable queue and presents one governed Yes/No proposal at a time."
                  prompt="Vibe review the current project’s hazard-analysis rows where Safety Significance is marked Needs Review. Review them one at a time, briefly explain each row, and propose Yes or No."
                />
                <PromptExample
                  title="Resolve shared evidence gaps in batch"
                  description="Opens the grouped architecture-question workflow when many unresolved rows depend on the same missing evidence."
                  prompt="Help me resolve the remaining Needs Review hazard rows in batch using grouped architecture evidence questions."
                />
                <PromptExample
                  title="Challenge existing Yes classifications"
                  description="Useful for finding false positives after the initial analysis."
                  prompt="Vibe review the current project’s hazard-analysis rows where Safety Significance is marked Yes. Review them one at a time. Propose retaining Yes or changing it to No using only the documented causal path and physical-harm chain."
                />
                <PromptExample
                  title="Ask an evidence-grounded question"
                  description="Collaborator can explain the analysis without changing it."
                  prompt="Summarize the current project’s highest-priority safety-significant hazard-analysis results and include links to the supporting source rows."
                />
                <PromptExample
                  title="Review a narrower hazard scope"
                  description="Name an exact table field and value to avoid an ambiguous review queue."
                  prompt="Vibe review hazard-analysis rows where Subsystem Allocation is Perception & World Modeling. Review exactly one row at a time and propose Yes or No."
                />
              </div>

              <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
                <span className="font-semibold">Prompted reviews and analysis buttons have different roles.</span>{" "}
                Use Collaborator prompts to inspect, revise, or Vibe Review functional architecture, answer workspace questions, and
                conduct row-by-row hazard Vibe Review, or open grouped Needs Review evidence resolution. Use the controls in Hazard Analysis and Safety Issues &amp; Risk
                Assessment to run the full analysis, regenerate consolidated safety issues, and generate reports.
              </div>
            </Section>

            <Section id="guide-local-data" icon={Database} title="Local-First Data Model" eyebrow="Open-source behavior">
              <BulletList
                items={[
                  "Workspace state is stored locally in browser storage and local IndexedDB-backed stores.",
                  "Secrets such as AI provider keys and GitHub tokens are entered locally and used by the local server/browser flow.",
                  "Generated backups, review packages, and Electron review apps are written to local files when you choose to export them.",
                  "The open-source app intentionally avoids Supabase, hosted authentication, telemetry, cloud persistence, and license enforcement.",
                ]}
              />
            </Section>

            <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
              <div className="mb-1 font-semibold">Engineering judgment still matters.</div>
              xHandle is an AI-assisted workspace. Treat generated architecture, hazards, requirements,
              remediation plans, and verification artifacts as review candidates until a qualified engineer
              has checked the evidence, assumptions, and safety impact.
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
