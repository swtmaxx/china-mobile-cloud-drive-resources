# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the Vite + React client, including the public resource browser (`App.tsx`), hidden admin UI (`Admin.tsx`), site settings, and shared CSS.
- `functions/` contains Cloudflare Pages Functions. API routes live under `functions/api/`; `_middleware.ts` handles shared request behavior.
- `lib/` contains server-side provider integration, KV storage, opaque-handle security, encryption, sessions, and resource rules. Keep secrets and provider logic here rather than in `src/`.
- `tests/` contains Vitest tests for API behavior, crypto, sessions, handles, the 139 client, and site settings. `dist/` is generated output and must not be edited.

## Build, Test, and Development Commands

```bash
npm install                 # install dependencies
npm run dev                 # Vite frontend only
npm run cf:dev -- --port 8793 # local Pages Functions runtime
npm run typecheck           # strict TypeScript check
npm test                    # run the Vitest suite
npm run build               # typecheck and create dist/
npm run preview             # preview the production build
```

Use `.dev.vars` for local Cloudflare secrets when running `cf:dev`; do not use production credentials or KV data locally.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, semicolons, and the existing double-quote style. Use PascalCase for React components and interfaces, camelCase for variables/functions, and kebab-case for multiword utility filenames (for example, `site-settings.ts`). Prefer existing helpers and Lucide icons. No formatter or linter is configured, so keep changes formatted consistently with nearby code.

## Testing Guidelines

Add focused behavior tests in `tests/*.test.ts` using Vitest. Cover authentication, encryption, KV/rule changes, and API status/error behavior when modifying those areas. Run `npm test`, `npm run typecheck`, and `npm run build` before submitting a change. After adding or modifying a feature or its functional tests, commit the verified change and push it to `origin/main` immediately.

## Commit & Pull Request Guidelines

Use short, focused English commit subjects in the existing style, such as `Polish admin dashboard UI` or `Add ...`. Keep unrelated changes separate. Pull requests should explain behavior changes, list verification commands, note Cloudflare/KV configuration implications, and include before/after screenshots for UI work. Do not leave a verified feature or test change only in the local working tree; push it after committing.

## Security & Configuration Tips

Never commit passwords, cookies, Authorization values, encryption keys, `.dev.vars`, or production configuration. Do not prefix server secrets with `VITE_`. Configure Pages variables, Secrets, and the `RESOURCE_KV` binding in Cloudflare. Preserve the repository convention of keeping production Wrangler configuration in the Pages dashboard.
