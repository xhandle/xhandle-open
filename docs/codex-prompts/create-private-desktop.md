# Implement a separate private xHandle desktop application

Execute this task to completion, preserving existing user changes. Create `xhandle/xhandle-desktop` as a private GitHub repository beside `xhandle-open`. Verify privacy before pushing. Keep all Electron code, dependencies, native packaging, and desktop automation outside the public application repository.

Use a Git submodule at `upstream/xhandle-open` pinned to an exact published commit. Never maintain copied or patched application source in the desktop repo. Put shared fixes in the public repo, and record both repository commits plus the upstream source URL in every desktop build. Reject dirty or mismatched source during packaging.

Migrate the existing read-only review exporter and preserve its JSON export and optional local native packaging integration. Implement the full desktop shell, a sandboxed isolated renderer with a narrow preload bridge, managed local backend bound only to loopback with per-launch authentication, a stable origin and persistent user-data directory, startup errors and process cleanup. Package the backend and its runtime dependencies; installed users must not need Node or npm for the full application.

Provide local setup, build, start, smoke verification, and packaging commands, locked dependencies, cross-platform CI, a deliberate submodule update workflow/PR, and private release artifacts. Preserve upstream MPL notices and include a source notice pointing to the exact public commit. Document workspace backup/import migration and signing/release limitations. Keep credentials out of source and artifacts.

Run meaningful checks for the shared integration, renderer/backend startup, actual packaged app, provenance, and migration of review packaging. Commit and push the separated work. Report the repository links, prompt, validation, and any remaining external prerequisites honestly. Do not claim signing or notarization without credentials.
