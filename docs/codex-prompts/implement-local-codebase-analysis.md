# Implement local codebase analysis

Implement the local-folder source described in `docs/investigations/local-codebase-analysis-review.md`.

- Add GitHub / Local project folder selection inside the existing repository configuration modal. Preserve GitHub defaults, verification, file types, AI behavior, and legacy projects.
- Choose a read-only project folder using a browser directory picker with a directory-input fallback. Handle cancel/reconnect/reload honestly; do not require Git or execute project code. Keep local source access separate from portable project JSON.
- Reuse the existing analysis pipeline through a common file-list/read/context interface. Local runs must never fall back to GitHub settings or credentials.
- Use stable source identity and content-based snapshot identity for local indexing, checkpoints, evidence, and exports. Detect changed files, bound memory/read volume, exclude generated/dependency/secret/binary files, and preserve prior results on failed runs.
- Carry local provenance into hazard and remediation source lookup and previews. Never open unrelated VS Code/GitHub source for a local reference.
- Verify with focused tests and isolated Chromium/WebKit fixtures, including mocked AI analysis, reload/reconnect, import/export identity, exclusions, cancellation, and GitHub regressions. No paid AI calls or modifications of user source folders.
- Document implementation and any practical limits. Do not commit or push unless requested.
