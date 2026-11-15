# apt repository

The `git-scope` package is published through a self-hosted apt repository at
**https://gitscope.dev-is.fun/apt** (VDS 87.120.187.166, nginx + Let's
Encrypt). Users add it as documented in the top-level README; updates arrive
with normal `apt upgrade`.

## Layout on the server

- `/var/www/gitscope` — website (`index.html`, `assets/`) and the repository
  under `apt/` (`dists/stable`, `pool/main/g/gitscope`).
- `/home/devodrag/gitscope-tools/update-repo.sh` — repository generator.
- `/home/devodrag/.gnupg/gitscope-archive` — the signing key (rsa3072, no
  passphrase, key id `A23957FECC871EE024B3AEEDB998C039D0AD285F`). Back this
  directory up; if it is lost, a new key must be created and the install
  instructions updated because users pin this key via `signed-by`.

## Publishing a new release

1. Download the freshly attached `GitScope_<version>_amd64.deb` from the
   GitHub release to `/tmp/gitscope.deb` on the server.
2. Rebuild and re-sign the repository (the script truncates the old Packages
   index first):

   ```bash
   GNUPGHOME=$HOME/.gnupg/gitscope-archive \
     ~/gitscope-tools/update-repo.sh /var/www/gitscope/apt /tmp/gitscope.deb
   ```

3. Update the versioned download links on the website (`index.html`).

Verification after publishing: `apt-get update` in a fresh Debian/Ubuntu
container must fetch `InRelease` and `Packages` without errors and resolve
`git-scope`.

## Notes

- The `.deb` declares `Depends: libsqlite3-0, libdbus-1-3, xdg-utils,
  libwebkit2gtk-4.1-0, libgtk-3-0` — all satisfied by Debian 12+ and
  Ubuntu 22.04+ repositories.
- Release checksum paths are relative to `dists/stable/`; keep the generator
  in sync with that layout, apt resolves index targets against it.
- Possible later improvement: run this step from the release workflow via
  an SSH secret instead of by hand.
