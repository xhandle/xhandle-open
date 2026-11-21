# Release Notes

## Desktop 0.2.20 (2026-11-21)

[Mac/Linux installers and update](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.20). Windows remains on 0.2.16.

- Choose Replace or Append when analyzing an existing code project. Append adds newly selected file types while preserving earlier evidence, trace IDs and analyst decisions.
- Append checks source-cited connections in both directions between earlier and newly analyzed files and includes accepted links in the combined architecture.
- Interrupted Append integration resumes saved progress without repeating completed file analysis. Complete JSON responses wrapped in Markdown/prose are accepted; malformed responses retain recovery progress.
- Hazard draft-worker failures stay in the retry interface and late messages cannot replace completed or retried results.
- Removed the connection-summary notice at the user's request; stored integration evidence remains available. Scrolling is unchanged.


## Desktop 0.2.19 (2026-11-20)

[Mac/Linux installers and update](https://github.com/xhandle/xhandle-desktop-releases/releases/tag/v0.2.19). Windows remains on 0.2.16.

- GitHub code analysis pauses automatically at API rate limits and resumes the same pinned source requests after reset. Concurrent reads share the wait; cancellation remains available.
- Code analysis retries transient browser-storage transaction aborts, preserves competing edits, and retains the interruption reason beside incomplete progress.
- Code analysis honors Stop during repository understanding and architecture classification, and rechecks provider settings before queued requests are sent.
- Scoped hazard analysis preserves user decisions in other operational contexts across reloads and reruns, prevents row-ID collisions, and rejects unavailable context selections.
- Hazard generation stops if provider/model/effort settings change, preserving partial recovery and keeping new checkpoints consistent with the settings used.
- Project traceability diagrams offer a multi-select Layers filter for relationship types and two-finger trackpad panning while retaining pinch zoom.
- Projects HARA includes rejected assessments in bounded reasoning repairs and recognizes explicit exclusions of failure probability in exposure rationales.

## v0.1.0

Initial public open-source release of xHandle.

### Highlights

- Local-first systems and safety engineering workspace built with React.
- AI-assisted functional architecture generation and review workflows.
- Textbook-backed hazard analysis methods for `STPA`, `FMEA`, and `What-If`.
- Traceability, requirements, and V&V workflows connected to analysis outputs.
- In-app and repo documentation for AI provider key setup and hosted deployment configuration.

### Included in This Release

- Functional decomposition and diagram editing workflows.
- Hazard analysis traceability outputs and exports.
- GitHub-based code-to-architecture exploration flow.
- Local browser-based AI provider key management for OpenAI, Claude, and Gemini.
- Open-source project docs: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and release checklist.

### Known Limitations

- This is still an MVP release and some workflows have rough edges.
- AI provider keys are stored locally in the browser in this OSS release.
- There is not yet a committed automated test suite.
- The production bundle is larger than ideal and should be optimized over time.

### Deployment Notes

- Hosted deployments should set `CORS_ALLOWED_ORIGINS` on the backend.
- Set `REACT_APP_BACKEND_URL` when the frontend and API are hosted on different origins.
- Leave `TRUST_X_ACCOUNT_ID` disabled unless a trusted upstream auth layer is providing that header.
