# Contributing to xHandle

Thanks for your interest in contributing to xHandle.

xHandle is an early open-source foundation for AI-assisted systems and safety engineering workflows. Contributions are welcome across product ideas, bug fixes, documentation, analysis methods, and infrastructure improvements.

## Before You Start

- Read the [README](./README.md) for product context and local setup.
- Review the [Code of Conduct](./CODE_OF_CONDUCT.md).
- For security-sensitive issues, do not open a public issue. Follow [SECURITY.md](./SECURITY.md) instead.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the full local stack:

```bash
npm run dev
```

This runs:

- the frontend on `http://localhost:3000`
- the backend API on `http://localhost:5001`

3. Optional configuration:

- Copy values from [`.env.example`](./.env.example) only if you need to override defaults.
- Most users can run the repo without creating a `.env` file.
- OpenAI keys are typically entered through the UI and stored locally in the browser.

## Contribution Guidelines

- Preserve behavior unless the change is intentionally behavioral.
- Keep pull requests focused and reviewable.
- Prefer local-first architecture decisions.
- Follow the existing repo structure:
  - shared UI in `src/components/*`
  - feature-owned logic in `src/features/*`
  - shared infrastructure in `src/lib/*`
  - docs in `docs/*`
- Avoid introducing accidental cloud-only assumptions into core workflows.

## Pull Request Checklist

Before opening a PR, please make sure:

- The scope and motivation are clearly explained.
- `npm run build` passes locally.
- New files are placed in the correct feature/shared folders.
- Docs are updated if setup, behavior, or architecture changed.
- Secrets, credentials, and local artifacts are not committed.

## Issues and Discussions

- Use GitHub Issues for bugs, feature requests, and focused improvement ideas.
- Include reproduction steps, expected behavior, and screenshots when helpful.
- If you are proposing a larger architectural change, opening an issue before a PR is appreciated.

## Development Notes

Additional project notes live in [docs/contributing.md](./docs/contributing.md) and related files under [`docs/`](./docs).

Thanks for helping make xHandle more useful and more understandable for other builders.
