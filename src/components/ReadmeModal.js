import React, { useEffect } from "react";
import {
  Bot,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Network,
  Rocket,
  ShieldAlert,
  Workflow,
  X,
} from "lucide-react";

const logoSrc = `${process.env.PUBLIC_URL || ""}/xHandle_Logo.PNG`;

function Section({ icon: Icon, title, eyebrow, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
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

export default function ReadmeModal({ open, onClose }) {
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
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

        <div className="flex-1 overflow-y-auto px-6 py-6">
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

            <Section icon={Rocket} title="Quick Start" eyebrow="First path">
              <StepList
                steps={[
                  "Open Settings, add your AI provider key, and choose OpenAI, Claude, or Gemini as the active provider.",
                  "Start with a GitHub repository for code-based architecture, or create a project manually or with AI-assisted prompts.",
                  "Generate or edit the functional decomposition table, then use the diagram and table views to inspect relationships.",
                  "Use the review workspace, assurance artifacts, hazard analysis, remediation, requirements, traceability, and V&V views to deepen the engineering record.",
                ]}
              />
            </Section>

            <Section icon={GitBranch} title="Code-Based Architecture" eyebrow="Repository analysis">
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

            <Section icon={Download} title="Generate Review App" eyebrow="Portable review artifact">
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

            <Section icon={ClipboardCheck} title="Assurance and Results Review" eyebrow="Review workspace">
              <BulletList
                items={[
                  "Use the assurance workspace after architecture generation to create and review engineering artifacts.",
                  "Manage software requirements, system requirements, subsystem requirements, design elements, and traceability views.",
                  "Use review statuses and review scaffolding to separate draft AI output from reviewed engineering decisions.",
                  "Export architecture review data for offline review through the local review app flow.",
                ]}
              />
            </Section>

            <Section icon={ShieldAlert} title="Hazard Analysis and Safety Remediation" eyebrow="Safety workflow">
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

            <Section icon={Network} title="Traceability, Requirements, and V&V" eyebrow="Connected artifacts">
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

            <Section icon={Workflow} title="Project and Cross-Repo Workspaces" eyebrow="Larger systems">
              <BulletList
                items={[
                  "Organize architecture projects and folders in the left sidebar.",
                  "Use cross-repo architecture views to inspect interfaces and relationships across multiple repositories.",
                  "Carry assurance artifacts and traceability context into folder-level review packages.",
                  "Use local storage and local backups to keep the workspace portable without cloud persistence.",
                ]}
              />
            </Section>

            <Section icon={Bot} title="Copilot / Collaborator" eyebrow="AI assistance">
              <BulletList
                items={[
                  "Ask questions about the current workspace, selected artifacts, architecture rows, hazards, risks, requirements, and remediation context.",
                  "Use your own provider keys through the local API server; supported providers are OpenAI, Claude, and Gemini.",
                  "Provider errors, quotas, and billing come from the provider account you configure. xHandle does not include hosted billing or paid gates.",
                  "For sensitive work, review prompts and generated outputs before treating them as engineering evidence.",
                ]}
              />
            </Section>

            <Section icon={Database} title="Local-First Data Model" eyebrow="Open-source behavior">
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
  );
}
