# Source-aware requirements derivation

The generation direction follows the selected diagrams automatically:

| Selected source | Derivation |
| --- | --- |
| Projects functional decomposition | System Requirements → Software Requirements and Hardware Requirements as parallel allocations |
| Code-Based Architecture decomposition | Software Requirements → System Requirements → Hardware Requirements |
| Both source types | Software Requirements from code → System Requirements from those software requirements plus Projects diagrams → Hardware Requirements |

Selecting a specification adds its prerequisites. The project dialog updates those prerequisites when the source type changes. Source selection takes precedence over the type of an owning project that has no selected diagram.

## Evidence and generation

`requirementDerivation.js` resolves the direction and upstream template. The same rules apply to project planning, standalone creation, source updates and drafting guidance. Downstream artifacts use compact, exact requirement-object references; they do not copy the parent's decomposition or nested evidence snapshots. For mixed sources, only System Requirements also receive Projects diagram evidence. Software receives code diagrams; Hardware receives System Requirements.

Standalone creation automatically selects a unique matching source specification and asks for a selection if several match. Sources must belong to the same owning projects and system. Accepted source revisions remain usable while a later proposal is incomplete; a completed initial draft can also supply requirements. Missing or incomplete prerequisites produce a specific message instead of falling back to unrelated notes or diagrams.

Generated requirements retain canonical parent object identities, revision numbers and content hashes. Missing parent citations remain review gaps. Source changes are checked again when a standalone proposal is created, restarted or accepted; project acceptance checks all dependencies together. Code-derived drafting distinguishes recovered software behavior and system abstraction from claims about intended behavior, runtime performance or verification.

## Existing projects and traceability

A changed dependency graph requires **Generate fresh update**. Saved accepted revisions remain unchanged. Source diagram changes recalculate the direction, and a fresh run puts the documents in the correct order. Moving an existing specification into a project preserves its existing evidence and binds the project's own prerequisite specification during fresh generation.

The traceability matrix reads the direction from source configurations, allowing both System → Software and code-derived Software → System links without silently reversing citations. Hardware stays downstream of System Requirements. Projects and code source rows are never rewritten by requirements generation. Custom engineering relationship profiles remain separate from recorded derivation provenance.

## Verification

Final checks: **303 tests passed across 12 suites**. The production renderer built successfully; scoped lint has no errors and retains two existing hook warnings in `ArtifactWorkspace.jsx`. A concurrent build caused one earlier GUI test to exceed its five-second timeout; the isolated GUI rerun and the complete run with a thirty-second integration timeout passed. Final Chrome and Electron runs each passed all three generation and acceptance workflows. The final staged renderer's source maps match the implementation, and the isolated desktop preview was refreshed and passed its health check.

Targeted tests cover source-specific planning, automatic prerequisites, generation order, compact parent evidence, standalone source selection, source freshness, switching direction, importing an existing software draft, publication and traceability. The broader checks cover artifact CRUD, generation recovery, architecture artifacts, worker behavior and UI workflows.

`scripts/diagnostics/design-requirement-direction-scenario.cjs` runs all three workflows through actual project creation, artifact workers, generation checkpoints, review and joint acceptance in isolated Chrome and Electron profiles. Each run supplies 54 controlled provider responses, verifies exact saved source links and confirms the functional decomposition and code rows are unchanged. No paid AI requests are made.

Reproduction:

```sh
XHANDLE_PLAYWRIGHT_MODULE=/private/tmp/xhandle-gui-audit-tools/node_modules/playwright-core \
  /opt/homebrew/opt/node@22/bin/node scripts/diagnostics/verify-design-derivation-matrix.cjs \
  --stage <staging-directory> --browser \
  --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --requirement-direction-only
```

Use `--electron <Electron executable>` instead of the browser options for the desktop run. These are isolated local preview builds; this change does not publish a desktop release.
