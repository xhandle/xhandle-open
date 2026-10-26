# Safari export with all analysis categories

## Report and evidence

On October 26, 2026, architecture-only export in Safari and import into Chrome succeeded, but exporting MANPADS with all categories reloaded Safari. The local report `com.apple.WebKit.WebContent-2026-10-26-112601.ips` (11:25:55 EDT) records EXC_BAD_ACCESS at address 0x78 with JavaScriptCore optimization, asyncGeneratorUnwrapYieldResumption, and asyncIteratorNextWithDriver frames. This is evidence of a native engine fault, not proof of out-of-memory or attribution to a particular application function.

## Change

Remove the remaining async-generator chain from archive record traversal and hazard export. Await sequential callbacks for each record and hazard page, and explicitly pull the synchronous value tokenizer. Preserve bounded token pages, cancellation, original hazard checksum validation (including omitted snapshot data), and destination-compatible descriptors. Emit the hazard manifest only after source integrity passes. Do not modify source project data.

The runtime fixture now verifies software, system, subsystem requirements and design alongside architecture, partial hazards, and continuation checkpoints.

## Validation

- Transfer unit/integration suite passes; focused hazard tests cover source integrity, snapshot omission, callback failure and cancellation before manifest publication.
- Isolated WebKit, Chromium and Electron export/import checks pass with all categories, partial hazards and cancellation.
- Targeted ESLint passes without warnings in the changed export modules.

Automated WebKit is not the user's installed Safari. The actual MANPADS export still needs confirmation there; this is a targeted mitigation, not a guarantee against every native browser crash. Changes are local and not yet included in a desktop release.
