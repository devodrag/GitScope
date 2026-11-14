# Contributing

Thank you for considering a contribution to GitScope. This document
describes the development setup and the expectations for changes.

## Development setup

Follow the build-from-source instructions in
[README.md](README.md#build-from-source) to install the toolchain and the
system dependencies for your distribution. Then:

```bash
npm ci
npm run tauri -- dev
```

## Before opening a pull request

Run the full check suite locally and make sure every command passes:

```bash
npm run typecheck
npm run lint
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The same suite runs in CI on every push and pull request. A pull request
with failing checks will not be merged.

## Expectations

- Keep changes focused: one pull request per logical change.
- Match the surrounding code style; do not reformat unrelated code.
- User-facing strings are bilingual English and Russian and live in
  `src/i18n.tsx` as single-line `English|Russian` pairs. Provide both
  translations for every new string.
- Public behavior changes and new metrics require a short entry in the
  pull request description explaining what changed and why.
- Never commit secrets, tokens or local data files. The repository must
  stay free of credentials.

## Reporting issues

Use the issue templates for bugs and feature requests. Include the
distribution and desktop environment, the GitScope version, and steps to
reproduce for bug reports.

## License

By contributing you agree that your contributions are licensed under the
MIT License that covers this project.
