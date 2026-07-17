#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh 0.1.1
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>  (e.g. 0.1.1)"
  exit 1
fi

TAG="v$VERSION"
REPO="genoventures-labs/Switchbay"
PACKAGE_NAME="switchbay"
TAP_REPO="genoventures-labs/homebrew-tap"
FORMULA_PATH="Formula/switchbay.rb"

echo "==> Releasing $TAG"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Release aborted: working tree is dirty."
  echo "Commit or stash changes before running the release script."
  exit 1
fi

# 1. Bump version in package.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# 2. Bump public version badge. Runtime surfaces read package.json directly.
sed -i "s/version-[0-9]*\.[0-9]*\.[0-9]*/version-$VERSION/" README.md

# 3. Commit, tag, push
git add package.json README.md
git commit -m "switchbay $TAG"
git tag "$TAG"
git push origin main
git push origin "$TAG"

# 4. Create tarball from git archive (avoids relying on GitHub's slow auto-generated archive)
TARBALL_NAME="${PACKAGE_NAME}-${VERSION}.tar.gz"
TARBALL_PATH="/tmp/$TARBALL_NAME"
echo "==> Building release tarball"
git archive --format=tar.gz --prefix="${PACKAGE_NAME}-${VERSION}/" "$TAG" -o "$TARBALL_PATH"
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

if [[ ! -f "$TMP_TAP/$FORMULA_PATH" ]]; then
  echo "Release aborted: $FORMULA_PATH does not exist in $TAP_REPO."
  echo "Create or rename the formula before running the release."
  exit 1
fi

sed -i \
  -e "s|^class .* < Formula|class Switchbay < Formula|" \
  -e "s|homepage \".*\"|homepage \"https://github.com/$REPO\"|" \
  -e "s|url \".*\"|url \"$TARBALL_URL\"|" \
  -e "s|sha256 \".*\"|sha256 \"$SHA256\"|" \
  -e 's|desc ".*"|desc "AI operating system for the terminal — persistent agent, multi-model routing, engines, skills, and plugins"|' \
  "$TMP_TAP/$FORMULA_PATH"

perl -0pi -e 's|  def install\n.*?\n  end|  def install\n    system "bun", "install", "--frozen-lockfile"\n    prefix.install Dir["*"]\n    rm_f bin/"switchbay"\n    (bin/"switchbay").write <<~SH\n      #!/bin/bash\n      exec bun "#{prefix}/index.tsx" "\$@"\n    SH\n  end|s' "$TMP_TAP/$FORMULA_PATH"

perl -0pi -e 's|exec bun "#\{prefix\}/index\.tsx" ""|exec bun "#{prefix}/index.tsx" "\$@"|g' "$TMP_TAP/$FORMULA_PATH"
perl -0pi -e 's|exec bun "#\{prefix\}/index\.tsx"$|exec bun "#{prefix}/index.tsx" "\$@"|gm' "$TMP_TAP/$FORMULA_PATH"
perl -0pi -e 's|export SWITCHBAY_LMSTUDIO_BASE=http://127\.0\.0\.1:1234/v1|export SWITCHBAY_LMSTUDIO_BASE=http://YOUR-LM-STUDIO-HOST:1234/v1|g' "$TMP_TAP/$FORMULA_PATH"
if ! grep -q 'SWITCHBAY_LMSTUDIO_API_KEY' "$TMP_TAP/$FORMULA_PATH"; then
  perl -0pi -e 's|(export SWITCHBAY_LMSTUDIO_BASE=http://YOUR-LM-STUDIO-HOST:1234/v1\n)|$1        export SWITCHBAY_LMSTUDIO_API_KEY=...\n|g' "$TMP_TAP/$FORMULA_PATH"
fi
if ! grep -q 'SWITCHBAY_MCP=on' "$TMP_TAP/$FORMULA_PATH"; then
  perl -0pi -e 's|(export ANTHROPIC_API_KEY=\.\.\.\n)|$1\n      Switchbay MCP bridge:\n        export SWITCHBAY_MCP=on\n        # or: export SWITCHBAY_TOOL_MODE=switchbay-mcp\n|g' "$TMP_TAP/$FORMULA_PATH"
fi

cd "$TMP_TAP"
git add "$FORMULA_PATH"
git commit -m "switchbay $TAG"
git push origin main

cd -
rm -rf "$TMP_TAP"

echo ""
echo "==> Done. Released $TAG"
echo "    brew upgrade switchbay  — will pick up the new version."
echo "    switchbay              — launches the renamed command."
