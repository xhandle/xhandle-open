# Release Checklist

Use this list before cutting a public xHandle release.

## Product Readiness

- Confirm the Settings modal only exposes integrations that are actually supported in this release.
- Sanity-check the three textbook hazard-analysis methods end to end.
- Smoke-test the main local-first workflow: create a project, run an analysis, inspect traceability, export artifacts.

## Deployment Readiness

- Set `CORS_ALLOWED_ORIGINS` on the backend for every hosted frontend origin.
- Set `REACT_APP_BACKEND_URL` on the frontend if the API is not served from the same origin.
- Leave `TRUST_X_ACCOUNT_ID` disabled for public deployments unless you have a trusted auth layer in front of the API.
- Set `XHANDLE_ACCOUNT_ID` if you want a stable server-side account identifier in hosted single-tenant environments.

## Security Readiness

- Review `SECURITY.md` contact details and response expectations.
- Make sure `.env` is excluded and no real secrets are committed.
- Verify users understand that AI provider keys are stored locally in the browser in this OSS release.

## Repo Hygiene

- Run `npm run build`.
- Review ESLint warnings and decide which ones must be fixed before tagging.
- Confirm `README.md`, `CONTRIBUTING.md`, and screenshots match the current product.
- Bump the package/app version if you want the release tag to match the repo state.
