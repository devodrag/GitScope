#!/usr/bin/env bash
# Builds an apt repository (dists/ + pool/) from a set of .deb files and signs
# it with the archive key. The result is meant to be published on the gh-pages
# branch and consumed by Debian, Ubuntu and derivatives:
#
#   ./update-repo.sh <repo-root> <deb> [<deb>...]
#
# Signing key lives in GNUPGHOME (default: ~/.gnupg/gitscope-archive); its
# public part is exported next to the repository metadata.
set -euo pipefail

repo_root=${1:?usage: update-repo.sh <repo-root> <deb> [<deb>...]}
shift
[[ ${#@} -ge 1 ]] || { echo "no .deb files given" >&2; exit 1; }

: "${GNUPGHOME:=$HOME/.gnupg/gitscope-archive}"
export GNUPGHOME
key_uid="GitScope Archive <devodrag@users.noreply.github.com>"

mkdir -p "$repo_root/dists/stable/main/binary-amd64" "$repo_root/pool/main/g/gitscope"
# Regenerate from scratch: the entry loop appends, so stale runs must not survive.
: > "$repo_root/dists/stable/main/binary-amd64/Packages"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
control_dir="$tmp/control"

for deb in "$@"; do
    [[ -f $deb ]] || { echo "missing $deb" >&2; exit 1; }
    name=$(basename "$deb")
    cp "$deb" "$repo_root/pool/main/g/gitscope/$name"
    mkdir -p "$control_dir"

    # Extract the control metadata; modern dpkg builds use zstd compression.
    ar p "$deb" control.tar.gz 2>/dev/null | tar -xz -C "$control_dir" 2>/dev/null \
        || ar p "$deb" control.tar.xz 2>/dev/null | tar -xJ -C "$control_dir" 2>/dev/null \
        || ar p "$deb" control.tar.zst | zstd -d | tar -x -C "$control_dir"

    python3 - "$control_dir/control" "$repo_root" "pool/main/g/gitscope/$name" >> \
        "$repo_root/dists/stable/main/binary-amd64/Packages" <<'PY'
import hashlib, sys

control_path, repo_root, filename = sys.argv[1], sys.argv[2], sys.argv[3]
fields, current = {}, None
for line in open(control_path, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line:
        current = None
        continue
    if line.startswith((" ", "\t")) and current:
        fields[current] += " " + line.strip()
        continue
    current, _, value = line.partition(":")
    fields[current.strip()] = value.strip()

data = open(f"{repo_root}/{filename}", "rb").read()
kept = ("Package", "Version", "Architecture", "Maintainer", "Installed-Size",
        "Depends", "Recommends", "Description")
for name in kept:
    if name in fields:
        print(f"{name}: {fields[name]}")
print(f"Filename: {filename}")
print(f"Size: {len(data)}")
for algo in ("MD5sum", "SHA1", "SHA256"):
    digest = hashlib.new(algo.replace("sum", "").lower(), data).hexdigest()
    print(f"{algo}: {digest}")
print()
PY
done

gzip -9cn - < "$repo_root/dists/stable/main/binary-amd64/Packages" \
    > "$repo_root/dists/stable/main/binary-amd64/Packages.gz"

cd "$repo_root"
python3 - > dists/stable/Release <<'PY'
import email.utils, hashlib, os, re, sys

print("Origin: GitScope")
print("Label: GitScope Archive")
print("Suite: stable")
print("Codename: stable")
print("Date:", email.utils.formatdate(usegmt=True))
print("Architectures: amd64")
print("Components: main")
print("Description: GitScope archive for Debian-based distributions")
for algo, header in (("md5", "MD5Sum"), ("sha1", "SHA1"), ("sha256", "SHA256")):
    print(header + ":")
    for dirpath, _, names in sorted(os.walk("dists")):
        for name in sorted(names):
            full = os.path.join(dirpath, name)
            # Checksum paths are relative to dists/stable, the directory the
            # Release file lives in, matching official archive layout.
            rel = re.sub(r"^dists/stable/", "", full)
            # Skip the Release file itself: it is being written right now and
            # cannot contain its own checksum.
            if re.search(r"(InRelease|Release)(\.gpg)?$", rel):
                continue
            data = open(full, "rb").read()
            print(f" {hashlib.new(algo, data).hexdigest():<40} {len(data):>12} {rel}")
PY

# Clearsigned InRelease for modern apt, detached signature for older tooling.
gpg --batch --yes --pinentry-mode loopback --local-user "$key_uid" \
    --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --pinentry-mode loopback --local-user "$key_uid" \
    --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release

gpg --armor --export "$key_uid" > gitscope-archive-keyring.asc
echo "apt repository built in $repo_root"
