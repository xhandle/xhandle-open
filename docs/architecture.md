# Architecture

## Intent
This project is local-first. Core workflows should run with local storage, local services, and self-contained modules.

## Source Tree Overview
- `src/App.js`: current top-level application shell that composes the primary workspace
- `src/app/`: route-oriented and app-shell scaffolding for newer app surfaces
- `src/components/`: shared presentational and reusable UI
  - `activity/`, `common/`, `layout/`, `diagrams/`, `modals/`, `tables/`, `ui/`, `utils/`
- `src/features/`: feature-owned UI and orchestration logic
  - `agents/`, `auth/`, `functional-architecture/`, `hazard-analysis/`, `reports/`, `requirements/`, `risk-register/`, `settings/`, `traceability/`
- `src/lib/`: shared non-UI infrastructure
  - `api/`, `constants/`, `hooks/`, `projects/`, `storage/`, `utils/`
- `src/license/`: licensing context and activation flows
- `src/vnv/`: verification and validation utilities
- `src/assets/`: static assets
- `src/styles/`: global and theme styles

## Dependency Direction
- Prefer `features -> components + lib`
- Prefer `components -> lib` for shared infra
- Avoid `lib -> features`
- Keep feature cross-imports explicit and minimal

## Storage and State
- Primary persistence: browser local storage + IndexedDB
- Keep storage access in `src/lib/storage`
- Keep network config in `src/lib/api`
- Expect some compatibility shims under `src/components/utils/*` while imports continue converging on `src/lib/*`

## Notes
- The repo is in a transitional state between older component-centric organization and newer feature/lib boundaries.
- Prefer extending the newer `features -> components + lib` direction rather than adding new cross-cutting utility logic to legacy locations unless a compatibility bridge is required.
