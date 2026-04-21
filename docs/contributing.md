# Contributing

## Principles
- Preserve behavior unless a change explicitly targets behavior
- Keep changes small and reviewable
- Prefer local-first architecture decisions

## Pull Request Checklist
- [ ] Scope explained
- [ ] Imports updated after file moves
- [ ] `npm run build` passes
- [ ] New files placed in the correct feature/shared folders
- [ ] No accidental cloud/vendor coupling introduced
- [ ] Docs updated when setup, env vars, or release-facing behavior changed

## Structure Guidelines
- Shared UI: `src/components/*`
- Feature code: `src/features/*`
- Shared infra/utilities: `src/lib/*`
- Docs: `docs/*`
