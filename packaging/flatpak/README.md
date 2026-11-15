# Flatpak packaging

Manifest, metainfo and desktop entry for the Flathub build. Flathub builds
are offline — crates.io and the npm registry are unreachable during module
builds — so dependencies are vendored into tarballs attached to the GitHub
release and referenced by checksum in the manifest.

## Vendoring dependencies

```bash
packaging/flatpak/vendor.sh                # cargo vendor -> src-tauri/vendor + .cargo/config.toml
tar -C src-tauri -czf gitscope-cargo-vendor-$VER.tar.gz vendor .cargo
tar -C . -czf gitscope-node-vendor-$VER.tar.gz node_modules
sha256sum gitscope-*-vendor-$VER.tar.gz
```

Upload both tarballs as release assets, then point the manifest's `archive`
sources at the new URLs and update the `commit` and `sha256` fields. The
generated `vendor/` and `.cargo/` directories stay uncommitted (see
`.gitignore`).

## Local build

1. Install the toolchain once:

   ```bash
   flatpak --user install -y flathub org.flatpak.Builder \
     org.gnome.Platform//51 org.gnome.Sdk//51 \
     org.freedesktop.Sdk.Extension.node24//26.08 \
     org.freedesktop.Sdk.Extension.rust-stable//26.08
   ```

2. Build and install (flatpak-builder blocks network, so this exercises the
   same offline path as the Flathub buildbot):

   ```bash
   flatpak --user run org.flatpak.Builder --install --force-clean --user \
     flatpak-build packaging/flatpak/com.devodrag.GitScope.yml
   ```

3. Run the app and the lint:

   ```bash
   flatpak run com.devodrag.GitScope
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
     packaging/flatpak/com.devodrag.GitScope.yml
   ```

## Publishing to Flathub

**Submission status (2026-11-15):** deferred. An earlier automated submission
(flathub/flathub#11193) was closed by the submission checker for an
incomplete checklist. The Flathub generative-AI policy prohibits
AI-generated or AI-assisted manifests and AI-opened submission pull
requests, so when resubmitting: the author hand-writes the manifest and the
pull request description, opens the PR personally, and handles all review
interactions. Verified build assets ready for that moment:

- Local build verified against org.gnome.Platform//51, manifest and
  build-dir pass flatpak-builder-lint.
- Demo video of the Flatpak build:
  <https://github.com/devodrag/GitScope/releases/download/v0.1.4/gitscope-flatpak-demo-0.1.4.mp4>
- Working reference manifest:
  <https://github.com/devodrag/flathub/blob/io.github.devodrag.GitScope/io.github.devodrag.GitScope.yml>

Procedure when ready:

1. Fork <https://github.com/flathub/flathub> (uncheck *Copy the master branch
   only*), clone it and create a branch from `new-pr`.
2. Hand-write the manifest at the repository root (use the reference above as
   documentation; retype it), commit, push and open a pull request titled
   `Add io.github.devodrag.GitScope` targeting the `new-pr` branch, with the
   full submission checklist and the demo video link.
3. Respond to reviewer comments personally; when asked, comment
   `bot, build` to trigger a test build of the manifest.
4. After approval and merge, an invitation to the per-app repository
   (`flathub/io.github.devodrag.GitScope`) arrives — accept it within a week
   with 2FA enabled on GitHub, then push releases there.

Keep metadata in sync: every upstream release adds a `<release>` element to
the metainfo, refreshes the vendored tarballs, and bumps `runtime-version`
only when the GNOME runtime is updated.
