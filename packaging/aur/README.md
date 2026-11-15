# AUR package

`PKGBUILD` builds the `gitscope-bin` package from the prebuilt release
executable. Publishing to the AUR requires an AUR account and its SSH key,
so it is performed manually.

**2026-11-15:** AUR registration is temporarily paused (automated account
creation wave, see aur-general). The PKGBUILD for the current release is
ready in this directory — submit as soon as registration reopens, then watch
the Arch news feed for the announcement.

1. Create an AUR account at <https://aur.archlinux.org/register>.
2. Clone the empty package base and copy the packaging files in:

   ```bash
   git clone ssh://aur@aur.archlinux.org/gitscope-bin.git
   cp packaging/aur/PKGBUILD packaging/aur/app.gitscope.desktop.desktop gitscope-bin/
   cd gitscope-bin
   ```

3. Verify the package locally:

   ```bash
   makepkg -si
   ```

4. Regenerate checksums if the release binary changed, commit and push:

   ```bash
   updpkgsums
   git add PKGBUILD app.gitscope.desktop.desktop .SRCINFO
   git commit -m "gitscope-bin 0.1.4"
   git push
   ```

Generate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO` before the
first push; the AUR rejects packages without it. Bump `pkgrel` for packaging
changes and `pkgver` for each new upstream release, then update
`sha256sums` with `updpkgsums`.
