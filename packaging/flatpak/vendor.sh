#!/usr/bin/env bash
# Prepares a vendored Cargo dependency tree for offline flatpak-builder
# builds. The generated vendor directory and cargo config stay local and
# must not be committed.
set -euo pipefail
cd "$(dirname "$0")/../../src-tauri"

cargo vendor vendor > /dev/null
mkdir -p .cargo
cat > .cargo/config.toml <<'TOML'
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
TOML
echo "vendored dependencies in src-tauri/vendor (uncommitted)"
