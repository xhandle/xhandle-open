# Release Notes

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
