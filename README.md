![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-brightgreen)

# xHandle (Open Source)

**An open-source foundation for building your own AI-powered systems & safety engineering platform**

---

## 🔥 What is xHandle?

xHandle is a platform for building, analyzing, and managing complex systems using AI.

It combines:
- Functional architecture modeling  
- Hazard analysis (STPA, FMEA, What-If)  
- Requirements generation  
- Traceability and V&V  
- AI-assisted engineering workflows  

All in a single environment.

---

## ⚡ Quick Start

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

## 📦 First-Time Setup

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

After the app starts:

1. Open the app and click the Settings gear.
2. Open the `AI Provider` tab.
3. Choose `OpenAI`, `Claude`, or `Gemini`.
4. Paste your provider secret key.
5. Click `Save Key`.

Notes:

* Keys are stored locally in your browser in this open-source release.
* You can save more than one provider key and use `Switch Provider` to change the active one.
* GitHub tokens for repo import go in the `GitHub` tab, not the `AI Provider` tab.

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

## 🧱 xHandle as a Foundation

xHandle is not just a tool — it is a foundation for building your own in-house engineering platform.

Every organization has different:

* processes
* risk models
* workflows
* compliance requirements

Instead of forcing teams into a fixed product, xHandle provides:

👉 A starting point
👉 A working system
👉 A flexible architecture

From there, teams can:

* modify existing capabilities
* remove what they don’t need
* build entirely new workflows
* integrate with internal systems

The capabilities included in this repo are **examples of what’s possible**, not a prescribed solution.

---

## 🧩 Build Your Own System

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

## ⚖️ Philosophy

Traditional tools:

* impose structure
* limit flexibility
* separate engineering from implementation

xHandle:

* adapts to your system
* evolves with your process
* treats AI as a core building block

> The goal is not to replace tools —
> it’s to give teams the ability to build their own.

---

## 🏢 Who this is for

xHandle is designed for:

* startups building complex systems
* teams without access to expensive tooling
* organizations with unique workflows
* companies that want full control over their engineering stack

---

## ❌ What this is NOT

* Not a polished enterprise product
* Not a one-size-fits-all solution
* Not a drop-in replacement for every workflow

---

## ✅ What this IS

* A working system you can build on
* A flexible architecture you can extend
* A foundation for your own tools

---

## ⚡ Why this exists

Today, teams rely on expensive, rigid tools that are:

* are costly
* require heavy setup
* are difficult to customize
* are not AI-native

xHandle takes a different approach:

> Run everything locally
> Use AI as a core primitive
> Customize it to your workflow

---

## 🏗 Architecture

* Frontend: React + React Flow
* AI: user-provided provider keys (OpenAI, Claude, Gemini)
* Storage: Local (browser / IndexedDB)

---

## 🟢 Local-first design

xHandle runs entirely locally:

* No database setup
* No cloud dependency
* Your data stays with you

---

## 🔑 Deployment Setup

For local onboarding, use the `Quick Start` and `First-Time Setup` sections above.

This section covers the extra settings to think about when you deploy xHandle anywhere beyond your own machine.

### Hosted deployments

If you deploy xHandle beyond localhost:

* set `CORS_ALLOWED_ORIGINS` on the backend
* set `REACT_APP_BACKEND_URL` if the API is on a different origin
* leave `TRUST_X_ACCOUNT_ID` off unless you have a trusted auth layer in front of the API

See [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) before cutting a public release.

---

⚠️ **Disclaimer**

This is an early open-source release.

* It is an MVP
* Some features are incomplete
* Some UI elements are placeholders
* Bugs are expected

---

## 🎯 Vision

xHandle is moving toward:

* Open architecture for engineering tools
* Plug-in based capabilities
* Agent-driven engineering workflows
* Real-time system understanding from code

---

## ⚠️ Commercial Use

This project is open source under MPL-2.0.

You can use xHandle in commercial environments, including internally within your organization.

If you modify core source files, those modifications must also remain open under MPL-2.0.

You are free to build proprietary systems on top of xHandle.

## 🤝 Contributing

If you're interested in:

* Improving the platform
* Adding new analysis methods
* Building plugins or integrations

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, workflow, and pull request guidance.

Please review [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating, and use [SECURITY.md](./SECURITY.md) for responsible disclosure of security issues.

---

## 📬 Contact
nick.malloy@interlocksystems.io

Built by Interlock Systems
[https://interlocksystems.io](https://interlocksystems.io)

---

## 📄 License

This project is licensed under the Mozilla Public License 2.0 (MPL-2.0).

You are free to use, modify, and distribute this software.  
Any modifications to MPL-covered files must also be made available under the same license.

See the LICENSE file for full details.

## ⭐ If you find this interesting

Give the repo a star — it helps a lot.
