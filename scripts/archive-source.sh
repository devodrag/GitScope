#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
mkdir -p outputs
tar --exclude=src-tauri/target --exclude=src-tauri/gen \
  --transform="s,^,GitScope-$version/," \
  -czf "outputs/GitScope-$version-source.tar.gz" \
  README.md ROADMAP.md ARCHITECTURE.md VERIFICATION.md LICENSE .gitignore \
  package.json package-lock.json tsconfig.json vite.config.ts index.html \
  tailwind.config.cjs postcss.config.cjs eslint.config.js src src-tauri scripts licenses
