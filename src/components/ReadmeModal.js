import React, { useEffect } from "react";
import { X, BookOpen, Rocket, GitBranch, FolderPlus, ShieldAlert, Bot, ClipboardCheck } from "lucide-react";

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon className="w-4 h-4" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-5 py-5 text-sm leading-7 text-gray-700">
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
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
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
        <div key={idx} className="flex gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
            {idx + 1}
          </div>
          <div className="text-sm leading-6 text-gray-700">{step}</div>
        </div>
      ))}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 mr-2 mb-2">
      {children}
    </span>
  );
}

export default function ReadmeModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-10 flex h-[90vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-[#F8FAFC] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">xHandle Guide</div>
                <div className="text-sm text-gray-500">
                  Learn how to navigate the platform and get value fast
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100"
              aria-label="Close guide"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* quick tags */}
          <div className="px-6 pb-4">
            <Pill>AI-powered architecture</Pill>
            <Pill>Hazard analysis</Pill>
            <Pill>Risk management</Pill>
            <Pill>Requirements & traceability</Pill>
            <Pill>Verification & validation</Pill>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-5xl space-y-6">
            {/* Hero */}
            <div className="rounded-3xl border border-indigo-200 bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-7 text-white shadow-sm">
              <h1 className="text-3xl font-semibold tracking-tight">Welcome to xHandle</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-indigo-50">
                xHandle helps you move from architecture to risk to requirements to verification
                in a single connected workflow. You can start from an existing codebase or define
                a system from scratch and let AI build the structure for you.
              </p>
            </div>

            <Section icon={Rocket} title="Quick Start">
              <StepList
                steps={[
                  "After logging in, click the profile button in the upper-right corner next to the settings gear. Add a profile picture and fill in your details.",
                  "Choose how you want to begin: explore code-based architecture from GitHub, or create your first project manually or with AI assistance.",
                  "Once your functional decomposition is ready, run hazard analysis using STPA, FMEA, What-If, or other supported methods.",
                  "Use the generated outputs to explore risk, create requirements, manage traceability, and experiment with AI-generated verification artifacts.",
                ]}
              />
            </Section>

            <Section icon={GitBranch} title="Explore Code-Based Architecture">
              <p className="mb-4">
                Use xHandle to transform a repository into an interactive functional architecture.
              </p>
              <StepList
                steps={[
                  "Open Settings and go to the GitHub integration.",
                  "Enter the repository owner and repository name.",
                  "If the repository is private, provide your GitHub token.",
                  "Sync the repository, select the file types you want to analyze, and generate the functional decomposition.",
                ]}
              />
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This can take a few minutes because the AI is analyzing your code and building a data-rich system representation.
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold text-gray-900">What you can do once it loads</div>
                <BulletList
                  items={[
                    "Double-click nodes and edges to inspect descriptions and relationships.",
                    "Manually rearrange the canvas to make the architecture easier to understand.",
                    "Filter elements to focus on the parts of the system you care about.",
                    "Toggle to table view for structured editing and review.",
                    "Hold Shift and drag across nodes, then use Add Selection → Analyze to turn a subset into a focused project.",
                  ]}
                />
              </div>
            </Section>

            <Section icon={FolderPlus} title="Create a Project">
              <p className="mb-4">
                Click the plus button under Projects in the left sidebar to create a new project.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-base font-semibold text-gray-900">Manual Mode</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Build your system architecture from scratch by defining functions, control
                    actions, and relationships directly.
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-base font-semibold text-gray-900">AI-Assisted Mode</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Answer guided prompts describing your system. xHandle generates a detailed
                    functional decomposition that you can refine in either diagram or table view.
                  </p>
                </div>
              </div>
            </Section>

            <Section icon={ShieldAlert} title="Run Hazard Analysis">
              <p className="mb-4">
                Once your functional decomposition is ready, use AI-powered analysis methods to
                identify risks and derive engineering artifacts.
              </p>

              <div className="mb-4">
                <Pill>STPA</Pill>
                <Pill>FMEA</Pill>
                <Pill>What-If</Pill>
                <Pill>Additional methods</Pill>
              </div>

              <BulletList
                items={[
                  "Generate hazards, risks, causal factors, and mitigation strategies.",
                  "Derive system requirements from identified mitigations.",
                  "Produce structured outputs that feed directly into downstream modules.",
                  "Expect more than 10 minutes for complex systems or large decompositions.",
                ]}
              />
            </Section>

            <Section icon={BookOpen} title="Explore the Platform">
              <div className="space-y-5">
                <div>
                  <div className="mb-1 text-base font-semibold text-gray-900">Console</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Get a top-down, cross-project view of system activity, risk posture, and recent changes.
                  </p>
                </div>

                <div>
                  <div className="mb-1 text-base font-semibold text-gray-900">Risk Management</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Review risks with full context, prioritize them, assign owners, and track mitigation progress.
                  </p>
                </div>

                <div>
                  <div className="mb-1 text-base font-semibold text-gray-900">Project Management</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Track project progress, artifact completion, and execution status across your portfolio.
                  </p>
                </div>

                <div>
                  <div className="mb-1 text-base font-semibold text-gray-900">Requirements & Traceability</div>
                  <p className="text-sm leading-6 text-gray-700">
                    Import analysis outputs, create requirements manually, and use AI to connect
                    functions, hazards, risks, mitigations, requirements, and tests into a living trace model.
                  </p>
                </div>
              </div>
            </Section>

            <Section icon={Bot} title="Collaborator">
              <BulletList
                items={[
                  "Collaborator uses your project data as context to generate insights and support engineering work.",
                  "In docked mode, the crosshair icon lets you capture targeted UI context for more precise prompts.",
                  "It is designed to help you navigate and reason across the platform’s connected data model.",
                ]}
              />
            </Section>

            <Section icon={ClipboardCheck} title="Verification & Validation">
              <p>
                The V&V area explores AI-generated test artifacts derived from functional
                architecture, hazard analysis, and requirements. This helps you move from analysis
                to verification using connected system context rather than disconnected documents.
              </p>
            </Section>

            <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-xs leading-6 text-gray-500">
              xHandle is still an MVP. Expect rough edges, bugs, and evolving capabilities. The goal
              is to make system engineering, hazard analysis, traceability, and verification more
              accessible and more connected.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
