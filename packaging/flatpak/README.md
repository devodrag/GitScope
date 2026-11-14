# Flatpak packaging

This directory contains the manifest, metainfo and desktop entry for a
Flatpak build of GitScope. flatpak-builder does not grant network access
during module builds, so Cargo dependencies must be vendored before the
build.

## Local build

1. Vendor the Cargo dependencies once; the generated files stay local and
   must not be committed (they are listed in `.gitignore`):

   ```bash
   packaging/flatpak/vendor.sh
   ```

2. Install the runtime and SDK extensions:

   ```bash
   flatpak install -y org.gnome.Platform//47 org.gnome.Sdk//47 \
     org.freedesktop.Sdk.Extension.node24/x86_64/24.08 \
     org.freedesktop.Sdk.Extension.rust-stable/x86_64/24.08
   ```

3. Build and install:

   ```bash
   flatpak-builder --user --install --force-clean \
     flatpak-build packaging/flatpak/com.devodrag.GitScope.yml
   flatpak run com.devodrag.GitScope
   ```

## Publishing to Flathub

Flathub hosts one application repository per app. After the local build is
verified:

1. Fork <https://github.com/flathub/flathub> and create the branch
   `com.devodrag.GitScope`.
2. Copy `com.devodrag.GitScope.yml`, the metainfo and the desktop entry
   into the branch root, plus the vendored Cargo archive (`cargo vendor`
   output compressed as a tarball and referenced as a local source, since
   Flathub builds are offline).
3. Validate the metainfo with `flatpak-builder-lint` or
   `appstreamcli validate` and open a pull request against flathub/flathub.

Keep `pkgver`-like metadata in sync: every upstream release adds a
`<release>` element to the metainfo and bumps `runtime-version` only when
the GNOME runtime is updated.
