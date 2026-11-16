# Hazard analysis organizational profile audit

The reviewed customer HARA was run with the organizational profile disabled. This change does not attribute its earlier quality findings to a profile or modify that saved analysis.

## Findings and changes

- Projects selected a fixed list of profile sections, dropping organization-defined sections. Hazard generation, operational-context generation, hazard review and safety-issue consolidation now receive the full effective profile, including project overrides. The existing bounded prompt formatter retains section boundaries and prioritizes governance when a large profile must be shortened.
- Projects HARA exposure reconciliation and item-level safety-goal consolidation omitted the profile. Both now receive the same effective context as assessment generation, and checkpoint reuse depends on their exact context-bearing prompts.
- STPA canonical hazard mapping omitted the profile even though catalog generation received it. Mapping now receives governed context; its checkpoint policy is versioned to invalidate older mappings.
- Projects could reuse rows generated before a profile was enabled or changed. Generated rows now record an effective context identity. Reuse requires an exact match; profile/override changes trigger reassessment on the next analysis run. Legacy rows without a reliable identity are reassessed once when generation is requested. Manual field edits and review decisions remain protected.
- Disabled runs explicitly record `effectiveEnabled: false`, clearing stale enabled provenance. Per-row identities distinguish mixed generation times and selected operational scopes.

The visible method menus in both areas contain STPA and HARA. Legacy adapters retain their existing compatibility behavior; no removed method was added back to the menus.

## Verification

- Final relevant automated gate: **186 suites, 1,802 tests passed**. Two existing live-provider tests were skipped (`vehicle-braking-001` and `autonomy-stack-001`); their output quality was not evaluated.
- Final production Electron renderer/native staging build passed; its source fingerprint remained unchanged throughout the build.
- Real Electron UI regression: **13 checks passed across 51 controlled provider requests**, with zero renderer errors or failure alerts.
- Harness support/provider tests: **7 passed**. The diagnostic result is accepted by the regression driver, and the current application fingerprint matches the tested Electron build.

| Area and method | Global profile disabled | Full enabled profile and custom section | Project override |
| --- | --- | --- | --- |
| Projects STPA | Passed | Passed | Enabled and project-disabled paths passed |
| Projects HARA | Passed | Passed | Enabled, changed and project-disabled paths passed |
| Code-Based Architecture STPA | Passed | Passed | Correct Code project used with unrelated Projects profile disabled |
| Code-Based Architecture HARA | Passed | Passed | Correct Code project used with unrelated Projects profile disabled |

The UI checks also verified saved effective-profile provenance, fresh generation after profile changes, and preservation of a manually edited HARA severity. Focused tests cover HARA goal/exposure context injection, custom sections, disabled profiles, override changes, canonical mapping and obsolete-checkpoint invalidation.

The new scenario is included in the standard Electron regression driver as `hazard-profile`. It uses an isolated synthetic workspace and controlled responses at `/api/chat`; it proves application context delivery and workflow behavior, not that a live model follows every policy correctly. Customer data, deployment, installers and releases were untouched.

## Reproduce

```sh
node scripts/diagnostics/run-electron-regression.cjs \
  --desktop /path/to/xhandle-desktop \
  --playwright /path/to/playwright-core \
  --out /tmp/xhandle-hazard-profile-check \
  --only build,hazard-profile
```

## Local evidence

- Unit gate: `/private/tmp/xhandle-hazard-profile-final-gate-20261116.json`
- Build: `/private/tmp/xhandle-hazard-profile-verified-electron-20261116/report.json`
- Electron UI: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-profile-live-EDllJV/result.json`

Initial runs of the new harness exposed fixture storage-key, completion-wait, action-label and metadata-reading assumptions; those were corrected. One intermediate build was marked failed by the source-drift guard while the cache fix was still being edited. The final build and UI run above use unchanged final application sources and passed.

The harness timeout-cleanup tests initially encountered the restricted sandbox's `ps` denial. They passed when rerun with process-inspection permission, and the earlier synthetic process tree was cleaned up.
