# Review organization-profile use in CBA hazard analysis

Perform a read-only implementation audit. Do not modify production code or customer data. Preserve existing uncommitted work.

Identify the methods exposed by Code-Based Architecture and any additional dispatch paths. Trace enabled/disabled organization-profile settings and project overrides from Settings through the CBA runner to generation, repair, classification and applicability screening. Inspect section selection, truncation, evidence precedence, checkpoint invalidation, saved provenance and stale-run detection. Verify HARA/FHA after the recent workflow changes. Distinguish passing context from actually putting it in model prompts. Identify limitations in deterministic post-processing and downstream requirements.

Run existing profile tests and focused mocked-model probes. Retain audit fixtures outside the active test suite if they assert defects. Report severity, exact files/functions, working behavior, gaps and a scoped implementation recommendation. Do not make standards-compliance claims or claim live-model/browser validation.
