# Platform-wide organizational context

Enabled organizational profiles now provide constructive bias to AI prompts throughout xHandle: Projects, Code-Based Architecture, Design Management, Reports, System Test, Collaborator and Safety Case. This uses the existing profile setting; disabling the profile or opting a project out suppresses the context. Explicit user instructions, task/output-format instructions and project evidence take precedence over organizational preferences.

## Implementation

- The shared AI request shim adds a bounded organization-context header to the app's chat endpoints, their aliases, the legacy prompt endpoint and realtime-session setup. It supports string URLs, URL objects and Request objects. Unrelated APIs and untrusted origins receive neither the profile nor provider credentials.
- The renderer compiles the saved profile only when its serialized content changes. A 32-entry cache reuses excerpts selected using workflow/task headings, common engineering guidance and the current project's override. No model summarization call, diagram scan or repository hydration is needed.
- General context is capped at **4,096 UTF-8 bytes**, and its encoded header is capped at **6,144 characters**. The renderer forwards large request bodies unchanged instead of parsing and serializing them again. Shortened excerpts are identified within the model context.
- The backend inserts the guidance once, ahead of the task's schema instructions, for OpenAI, Claude and Gemini. Existing governed full-profile prompts, including hazard analysis, retain that context without an additional duplicate. Realtime wizard response instructions also retain the guidance when overriding session instructions.
- Projects and Code-Based Architecture use their own project overrides. A Design document with one source owner uses that owner's override; library and multi-project views use global guidance. Background Code requirements capture their original context instead of adopting a subsequently opened project's policy.
- Enabled-profile identities participate in Code requirements/hazard checkpoints and Design source freshness. Disabled runs retain their previous cache namespace. This avoids reusing work generated with a different effective profile.
- Native backend staging now includes `src/lib/organizationPromptPolicy.js`. The staging script and its test were updated in the adjacent `xhandle-desktop` repository; shared application logic remains in this repository.

The Electron checks also found and fixed an existing Request forwarding problem: explicitly resupplying an inherited body turned it into a streaming body requiring `duplex` in Chromium. The shim now lets Request inherit its own body, cancellation and fetch options.

## Verification

| Check | Result |
| --- | --- |
| Full frontend gate | 479 suites and 4,334 tests passed; 2 suites / 4 tests skipped |
| Targeted final UI/context tests | 90 passed; the final Request compatibility change was then checked by 21 focused tests and the rebuilt Electron run |
| Backend suite | 91 passed; final chat/realtime/legacy-prompt changes were checked again by 11 focused tests |
| Native Node tests | 49 passed, including shared-policy staging |
| Harness self-tests | 3 passed with process-inspection permission |
| Fresh production build and native smoke | Passed; native protocol, backend, persistence and reload checks passed |
| STPA/HARA Electron profile regression | 13 checks, 51 controlled provider requests, zero renderer errors or failure alerts |
| Platform-wide Electron regression | 12 checks, 174 controlled requests, zero renderer errors |
| Source drift / whitespace | Application and native runtime fingerprints match the tested stage; both repositories pass `git diff --check` |

The production backend tests inspect the actual provider payloads for enabled and disabled profiles across all three chat providers, verify CORS preflight and realtime instructions, and check the legacy prompt endpoint. The Electron checks exercise the installed request shim and actual App project scope, a two-million-character request, project opt-outs, immediate global disablement, and Request/URL forms.

### Request-preparation performance

Measured in the production Electron 45 renderer on macOS arm64 using a synthetic profile of approximately 43 KB, with 40 extra policy sections and 80 sequential requests per condition. Timing covers synchronous request preparation, excluding network/model latency; the first request is reported separately.

| Measurement | Disabled | Enabled |
| --- | ---: | ---: |
| First request | 0.3 ms | 1.0 ms |
| Cached median | 0.1 ms | 0.1 ms |
| Cached p95 | 0.2 ms | 0.2 ms |
| Cached maximum | 0.2 ms | 0.3 ms |

There was no measurable cached p95 increase at the renderer timer's resolution in this run. The largest delivered context in this fixture was 2,386 bytes / 3,252 encoded header characters; separate boundary tests cover longer, Unicode and quote-heavy profiles. The implementation adds no AI round trip. Extra context still consumes provider input tokens; this test does not measure remote inference latency or guarantee that a model follows every policy.

## Reproduce

```sh
node scripts/diagnostics/run-electron-regression.cjs \
  --desktop /path/to/xhandle-desktop \
  --playwright /path/to/playwright-core \
  --out /tmp/xhandle-platform-profile-check \
  --only shell,hazard-profile,platform-profile
```

This command builds the current production renderer and stages the native backend before running the isolated Electron checks. Provider replies are controlled; no customer data or real API credentials are used.

Local evidence:

- Full frontend results: `/private/tmp/xhandle-platform-profile-full-20261116.json`
- Backend / native results: `/private/tmp/xhandle-platform-profile-backend-20261116.log`, `/private/tmp/xhandle-platform-profile-native-20261116.log`
- Final route / focused results: `/private/tmp/xhandle-platform-profile-complete-route-20261116.log`, `/private/tmp/xhandle-platform-profile-complete-focus-20261116.log`
- Final build and Electron report: `/private/tmp/xhandle-platform-profile-complete-electron-20261116/report.json`
- Platform checks and timings: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-platform-profile-K9oywO/result.json`
- Hazard workflow checks: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-profile-live-OrepKo/result.json`

The current run verifies macOS Electron execution and shared browser/backend behavior. It does not certify live-model output quality, Windows/Linux execution, signed installers or an update release. No commit, push, deployment or publication was performed.
