![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-brightgreen)

# xHandle (Open Source)

**A local-first, open-source workspace for AI-assisted systems and safety engineering**

---

## What Is xHandle?

xHandle is a local engineering workspace for building, analyzing, reviewing, and managing complex systems with AI assistance.

It combines:

* functional architecture modeling
* code-based architecture decomposition
* hazard analysis workflows including STPA, FMEA, What-If, HARA/FHA, STPA-Sec, and code-hazard review
* requirements and design-management workflows
* traceability and V&V planning
* safety case construction
* safety remediation tracking
* review, assurance, and export flows for architecture artifacts
* a local Copilot/Collaborator experience powered by your own AI provider keys

The open-source version is intentionally local-only. It does not use Supabase, hosted auth, billing gates, paid license checks, telemetry, or cloud persistence.

---

## Current Capabilities

This release includes a larger local feature set than the initial open-source commit:

* Functional architecture generation from prompt input or GitHub repository files.
* Code-based architecture analysis with functional decomposition tables and interactive diagrams.
* Code architecture review package export for creating local review artifacts.
* Assurance and review workspaces for generated architecture data.
* Results review state, review center scaffolding, and review status helpers.
* Safety remediation views for findings, impact files, patch proposals, review decisions, and verification evidence.
* Requirements/design-management tools with local persistence.
* Risk register and project-management views.
* Traceability and V&V support.
* Safety case diagramming and evidence review helpers.
* Local AI provider support for OpenAI, Claude, and Gemini through the local API server.

---

## Quick Start

xHandle runs locally with no `.env` setup required:

```bash
npm install
npm run dev
```

This starts:

* the React app on `http://localhost:3000`
* the local API server on `http://localhost:5001`

The local startup scripts are cross-platform, so the same `npm run dev` command works on macOS, Linux, and Windows.

---

## First-Time Setup

If this is your first time using GitHub on Windows or macOS, this section will get you from zero to a working local copy of xHandle.

### What you need

* Git
* Node.js and npm
* A local clone of this repository

### Basic workflow

```bash
git clone https://github.com/xhandle/xhandle-open.git
cd xhandle-open
npm install
npm run dev
```

This starts:

* the React app on `http://localhost:3000`
* the local API server on `http://localhost:5001`

If you plan to publish your own changes on GitHub, fork the repository first and clone your fork instead of the main project.

### On Windows

#### 1. Install Git

Open PowerShell and run:

```powershell
winget install --id Git.Git -e --source winget
```

If you do not have admin rights, try:

```powershell
winget install --id Git.Git -e --source winget --scope user
```

#### 2. Install Node.js

Install the recommended LTS version:

```powershell
winget install OpenJS.NodeJS.LTS
```

If needed, use user scope:

```powershell
winget install OpenJS.NodeJS.LTS --scope user
```

#### 3. Verify the installation

Close and reopen PowerShell, then run:

```powershell
git --version
node -v
npm -v
```

#### 4. Clone the repository and run it

```powershell
git clone https://github.com/xhandle/xhandle-open.git
cd xhandle-open
npm install
npm run dev
```

### On macOS

#### 1. Install Git

Open Terminal and run:

```bash
git --version
```

If Git is not installed, macOS may prompt you to install the Xcode Command Line Tools. Accept that prompt.

#### 2. Install Node.js

Recommended option with Homebrew:

```bash
brew install node
```

If you do not have Homebrew installed, install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install Node.js:

```bash
brew install node
```

#### 3. Verify the installation

```bash
git --version
node -v
npm -v
```

#### 4. Clone the repository and run it

```bash
git clone https://github.com/xhandle/xhandle-open.git
cd xhandle-open
npm install
npm run dev
```

### Optional environment setup

xHandle can run locally without a `.env` file.

If you want to override settings, copy `.env.example` to `.env` and fill in the values you want to override.

### AI provider setup

AI workflows use your own provider keys. The browser sends requests to the local xHandle API server, and the local server forwards them to the selected provider.

After the app starts:

1. Open the app and click the Settings gear.
2. Open the `AI Provider` tab.
3. Choose `OpenAI`, `Claude`, or `Gemini`.
4. Paste your provider secret key.
5. Click `Save Key`.

Notes:

* Keys are stored locally in your browser in this open-source release.
* You can save more than one provider key and use `Switch Provider` to change the active one.
* Model preferences are also stored locally and sent through the local API proxy.
* GitHub tokens for repo import go in the `GitHub` tab, not the `AI Provider` tab.
* Provider billing and quota errors come from the selected provider account. xHandle does not include hosted billing, license enforcement, or paid SaaS gates.

### GitHub repository analysis

The code-based architecture workflow can inspect public GitHub repositories without a token. For private repositories or higher rate limits, add a GitHub token in Settings under the `GitHub` tab.

Repository analysis runs locally in the browser and local API server. Generated rows, review state, assurance artifacts, and related workspace data are stored in local browser storage.

### Troubleshooting

#### "git" or "node" is not recognized

This usually means the install completed but your terminal does not see it yet.

Try:

* closing and reopening the terminal
* restarting your computer
* reinstalling Git or Node.js
* checking that the install location was added to your `PATH`

#### PowerShell blocks npm commands

If PowerShell restricts scripts, try:

```powershell
npm.cmd install
npm.cmd run dev
```

Or adjust execution policy in PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

#### "PORT" is not recognized

The current repo uses cross-platform startup scripts, so `npm run dev` should work on Windows without editing environment variables by hand.

If you still see a message like `"PORT" is not recognized as an internal or external command`, make sure you pulled the latest version of the repo and rerun:

```powershell
npm install
npm run dev
```

#### Wrong directory

Run `npm install` and `npm run dev` from the repo folder where `package.json` exists:

```powershell
cd xhandle-open
dir package.json
```

#### Node or npm version issues

If you run into version issues, use Node `20`.

Check your version:

```bash
node -v
npm -v
```

#### Permission or install failures

If `npm install` fails:

* try reopening the terminal as administrator
* delete `node_modules` and rerun `npm install`
* make sure you are inside the cloned repo folder before running commands

---

## xHandle As A Foundation

xHandle is not just a tool. It is a foundation for building your own in-house engineering platform.

Every organization has different:

* processes
* risk models
* workflows
* compliance requirements

Instead of forcing teams into a fixed product, xHandle provides:

* a starting point
* a working local system
* a flexible architecture

From there, teams can:

* modify existing capabilities
* remove what they don’t need
* build entirely new workflows
* integrate with internal systems

The capabilities included in this repo are **examples of what’s possible**, not a prescribed solution.

---

## Build Your Own System

With xHandle, organizations can:

* create custom hazard analysis pipelines
* define their own traceability models
* build internal safety processes
* integrate with codebases, tools, and data sources
* evolve the platform alongside their system

This is especially powerful for teams that:

* cannot rely on rigid commercial tools
* need domain-specific workflows
* want full control over their engineering environment

---

## Philosophy

Traditional tools:

* impose structure
* limit flexibility
* separate engineering from implementation

xHandle:

* adapts to your system
* evolves with your process
* treats AI as a core building block

> The goal is not to replace every tool. It is to give teams the ability to build their own.

---

## Who This Is For

xHandle is designed for:

* startups building complex systems
* teams without access to expensive tooling
* organizations with unique workflows
* companies that want full control over their engineering stack

---

## What This Is Not

* Not a polished enterprise product
* Not a one-size-fits-all solution
* Not a drop-in replacement for every workflow
* Not a hosted SaaS application
* Not a Supabase-backed application
* Not a cloud persistence layer

---

## What This Is

* A working system you can build on
* A flexible architecture you can extend
* A foundation for your own tools
* A local-first app that stores project data in your browser
* A place to experiment with AI-assisted systems and safety workflows

---

## Why This Exists

Today, teams rely on expensive, rigid tools that are:

* costly
* require heavy setup
* are difficult to customize
* are not AI-native

xHandle takes a different approach:

* Run everything locally.
* Use AI as a core primitive.
* Customize it to your workflow.

---

## Architecture

* Frontend: React + React Flow
* Local API server: Express
* AI: user-provided provider keys for OpenAI, Claude, and Gemini
* Storage: browser localStorage and IndexedDB
* Review packaging: local artifact export flows

---

## Local-First Design

xHandle runs entirely locally:

* No database setup
* No Supabase
* No hosted auth
* No paywall or license activation
* No telemetry
* No cloud persistence
* Your data stays with you

---

## Validation

Before opening a pull request or preparing a release, run:

```bash
npm run build
```

Focused tests can also be run with:

```bash
npm test -- --watchAll=false --runTestsByPath src/components/LitePromptHandler.test.js src/features/code-architecture-review/codeArchitectureReviewExport.test.js
```

The current app builds with a known ESLint warning backlog in some large ported components. Treat new warnings and build failures as cleanup work before committing.

### Advanced local configuration

For normal local use, `npm run dev` is enough.

If you fork xHandle and run the frontend/backend on different origins, configure:

* `CORS_ALLOWED_ORIGINS` on the local API server
* `REACT_APP_BACKEND_URL` for the frontend

Avoid adding hosted auth, cloud persistence, license enforcement, telemetry, or deployment-only assumptions to this open-source app unless they are isolated behind explicit local-safe fallbacks.

---

## Status

This is an early open-source release.

* It is usable, but still evolving.
* Some review, assurance, and remediation workflows are intentionally lightweight scaffolding.
* Local browser storage is convenient, but it is not a substitute for a managed production data store.
* Bugs are expected

---

## Vision

xHandle is moving toward:

* Open architecture for engineering tools
* Plug-in based capabilities
* Agent-driven engineering workflows
* Real-time system understanding from code

---

## Commercial Use

This project is open source under MPL-2.0.

You can use xHandle in commercial environments, including internally within your organization.

If you modify core source files, those modifications must also remain open under MPL-2.0.

You are free to build proprietary systems on top of xHandle.

## Contributing

If you're interested in:

* Improving the platform
* Adding new analysis methods
* Building plugins or integrations

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, workflow, and pull request guidance.

Please review [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating, and use [SECURITY.md](./SECURITY.md) for responsible disclosure of security issues.

---

## Contact
nick.malloy@interlocksystems.io

Built by Interlock Systems
[https://interlocksystems.io](https://interlocksystems.io)

---

## License

This project is licensed under the Mozilla Public License 2.0 (MPL-2.0).

You are free to use, modify, and distribute this software.  
Any modifications to MPL-covered files must also be made available under the same license.

See the LICENSE file for full details.

## If You Find This Interesting

Give the repo a star — it helps a lot.
