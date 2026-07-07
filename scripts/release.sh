#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh 0.1.1
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. 0.1.1)"
  exit 1
fi

TAG="v$VERSION"
REPO="genoventures-labs/ori-code"
TAP_REPO="genoventures-labs/homebrew-tap"
FORMULA_PATH="Formula/ori-code.rb"

echo "==> Releasing $TAG"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Release aborted: working tree is dirty."
  echo "Commit or stash changes before running the release script."
  exit 1
fi

# 1. Bump version in package.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# 2. Bump version string in CLI
sed -i "s/switchbay [0-9]*\.[0-9]*\.[0-9]*/switchbay $VERSION/" src/cli/args.ts
sed -i "s/version-[0-9]*\.[0-9]*\.[0-9]*/version-$VERSION/" README.md

# 3. Commit, tag, push
git add package.json src/cli/args.ts README.md
git commit -m "switchbay $TAG"
git tag "$TAG"
git push origin main
git push origin "$TAG"

# 4. Create tarball from git archive (avoids relying on GitHub's slow auto-generated archive)
TARBALL_NAME="${REPO##*/}-${VERSION}.tar.gz"
TARBALL_PATH="/tmp/$TARBALL_NAME"
echo "==> Building release tarball"
git archive --format=tar.gz --prefix="${REPO##*/}-${VERSION}/" "$TAG" -o "$TARBALL_PATH"
SHA256=$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')
echo "    SHA256: $SHA256"

# 5. Create GitHub release and upload tarball as asset
echo "==> Creating GitHub release $TAG"
gh release create "$TAG" \
  --title "$TAG" \
  --notes "$(git log "$(git describe --tags --abbrev=0 HEAD^)"..HEAD --oneline 2>/dev/null || echo "Release $TAG")" \
  "$TARBALL_PATH"

TARBALL_URL="https://github.com/$REPO/releases/download/$TAG/$TARBALL_NAME"
echo "    Asset URL: $TARBALL_URL"

# 6. Clone tap repo, update formula, push
echo "==> Updating homebrew-tap formula"
TMP_TAP=$(mktemp -d)
git clone "https://github.com/$TAP_REPO.git" "$TMP_TAP"

sed -i \
  -e "s|url \".*\"|url \"$TARBALL_URL\"|" \
  -e "s|sha256 \".*\"|sha256 \"$SHA256\"|" \
  -e 's|desc ".*"|desc "Terminal-first AI coding workbench with cloud and local model lanes"|' \
  -e 's|export HARNESS_LANE|export SWITCHBAY_LANE|g' \
  -e 's|HARNESS_LMSTUDIO|SWITCHBAY_LMSTUDIO|g' \
  -e 's|assert_match "code-harness", shell_output("#{bin}/code-harness --help 2>&1")|assert_match "switchbay", shell_output("#{bin}/switchbay --help 2>\&1")|' \
  "$TMP_TAP/$FORMULA_PATH"

if ! grep -q 'bin/"switchbay"' "$TMP_TAP/$FORMULA_PATH"; then
  perl -0pi -e 's|(def install\n\s+system "bun", "install", "--frozen-lockfile"\n)|$1    (bin/"switchbay").write <<~SH\n      #!/bin/bash\n      exec bun "#{prefix}/index.tsx" "$@"\n    SH\n|s' "$TMP_TAP/$FORMULA_PATH"
fi

cd "$TMP_TAP"
git add "$FORMULA_PATH"
git commit -m "switchbay $TAG"
git push origin main

cd -
rm -rf "$TMP_TAP"

echo ""
echo "==> Done. Released $TAG"
echo "    brew upgrade ori-code  — will pick up the new version."
echo "    switchbay              — launches the renamed command."
