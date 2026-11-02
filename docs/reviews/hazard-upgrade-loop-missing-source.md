# Hazard storage upgrade loop after project import

## Reproduction and diagnosis

The user reported Desktop 0.2.13 repeatedly offering a saved-table storage upgrade after importing a project. The supplied archive imported normally into an isolated fake IndexedDB database and a fresh Electron profile. Its archive categories excluded hazard analyses, and it contained no saved hazard runs.

An isolated copy of the desktop IndexedDB storage reproduced the reported prompt. Three retained legacy hazard descriptors referenced 81,727, 82,219 and 78,131 chunks respectively, with zero matching chunks present for each generation. The latest descriptor was selected on opening the hazard tab. The production upgrade worker rejected it with "Saved analysis has missing chunks. Upgrade did not change the analysis." The remaining self-contained run was incomplete and contained no summary or partial rows. These observations do not establish how or when the chunks were removed.

The read path treated every invalid/missing derived index as upgradeable without checking whether the underlying source was still present. Worker failures returned to the same upgrade-required presentation. Some abort/empty errors could also leave the failure reason hidden or empty.

## Change

- Before offering a legacy index upgrade, count the generation's source keys without loading result cells. Missing chunks produce a structured incomplete-source failure and visible backup/new-analysis guidance.
- Preserve the same error classification across the upgrade worker boundary if chunks disappear during the operation.
- Show explicit upgrade failure reasons, including a fallback for empty messages. Distinguish a storage AbortError from an explicitly requested cancellation.
- Validate rebuilt indexes before publishing them. Authoritative source pages and existing descriptors remain untouched on failure.
- Offer an explicit new-analysis action for this failure, using the existing regeneration flow and eligibility/review-mode guards. It does not delete the old saved records or automatically start AI work.

## Validation

Seven targeted suites / 108 tests passed, including new missing-source regressions for complete and paged reads, worker failure presentation, empty/abort errors and explicit regeneration. Focused lint and diff checks passed. The production build passed with existing lint/bundle warnings. In real Electron, the old bundle showed the upgrade prompt against the copied profile. The rebuilt bundle showed the incomplete-source guidance, no upgrade prompt, and an enabled explicit new-analysis button against that same profile. Source records were retained.

The archive and desktop database copy were used only for local diagnosis. No archive, project content, copied database or credentials are included in this change. Missing analysis cells cannot be reconstructed from descriptors; recovery requires another intact source or a new analysis.
