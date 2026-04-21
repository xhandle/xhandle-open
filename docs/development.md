# Development

## Prerequisites
- Node.js 18+
- npm

## Run
- `npm install`
- `npm run dev`

This starts both:
- the frontend development server on `http://localhost:3000`
- the backend API server on `http://localhost:5001`

## Build
- `npm run build`

## Hosted Configuration
- Set `CORS_ALLOWED_ORIGINS` on the backend for any non-local frontend origin
- Set `REACT_APP_BACKEND_URL` when the API is hosted on a different origin than the frontend
- Leave `TRUST_X_ACCOUNT_ID` disabled unless a trusted upstream auth layer is setting `x-account-id`

## Project Conventions
- Keep logic local-first by default
- Place reusable UI in `src/components/*`
- Place feature-specific orchestration in `src/features/*`
- Place shared infra in `src/lib/*`
- Prefer small, behavior-preserving refactors

## Verification
- Run `npm run build` after structural changes
- Fix module paths incrementally after moves
- Treat runtime and build parity as the acceptance gate
- There is not yet a committed automated test suite, so smoke-testing core flows is still important
