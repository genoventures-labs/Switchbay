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

# 1. Bump version in package.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# 2. Bump version string in CLI
sed -i "s/ori-code [0-9]*\.[0-9]*\.[0-9]*/ori-code $VERSION/" src/cli/args.ts

# 3. Commit, tag, push
git add package.json src/cli/args.ts
git commit -m "Bump version to $VERSION"
git tag "$TAG"
git push origin main
git push origin "$TAG"

# 4. Create GitHub release
echo "==> Creating GitHub release $TAG"
gh release create "$TAG" \
  --title "$TAG" \
  --notes "$(git log "$(git describe --tags --abbrev=0 HEAD^)"..HEAD --oneline 2>/dev/null || echo "Release $TAG")"

# 5. Wait a moment for GitHub to generate the tarball
echo "==> Waiting for release tarball..."
sleep 5

# 6. Fetch SHA256 of the release tarball
TARBALL_URL="https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz"
echo "==> Fetching SHA256 from $TARBALL_URL"
SHA256=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')
echo "    SHA256: $SHA256"

# 7. Clone tap repo, update formula, push
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
