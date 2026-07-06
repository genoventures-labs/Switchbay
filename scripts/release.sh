#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh 0.1.1
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. 0.1.1)"
  exit 1
fi

TAG="v$VERSION"
REPO="cassianwolfe/ori-code"
TAP_REPO="cassianwolfe/homebrew-tap"
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
sed -i "s/code-harness [0-9]*\.[0-9]*\.[0-9]*/code-harness $VERSION/" src/cli/args.ts

# 3. Commit, tag, push
git add package.json src/cli/args.ts
git commit -m "code-harness $TAG"
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
  "$TMP_TAP/$FORMULA_PATH"

cd "$TMP_TAP"
git add "$FORMULA_PATH"
git commit -m "ori-code $TAG"
git push origin main

cd -
rm -rf "$TMP_TAP"

echo ""
echo "==> Done. Released $TAG"
echo "    brew upgrade ori-code  — will pick up the new version."
