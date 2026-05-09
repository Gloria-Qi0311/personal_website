#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# install-hooks.sh — installs a pre-commit hook that auto-rebuilds
# the static artifacts (index.html, llms.txt, llms-full.txt) whenever
# any content/*.json file is staged for commit.
#
# Run once after cloning the repo:
#   bash scripts/install-hooks.sh
# ──────────────────────────────────────────────────────────────────────
set -e

HOOK_DIR="$(git rev-parse --git-path hooks)"
DEST="$HOOK_DIR/pre-commit"

cat > "$DEST" <<'EOF'
#!/usr/bin/env bash
# Auto-rebuild static artifacts when content changes.
# Installed by scripts/install-hooks.sh — do not commit this file.
set -e

if git diff --cached --name-only --diff-filter=ACMR \
   | grep -qE '^content/.*\.json$'; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  echo "[pre-commit] content changed — running build…"
  node "$REPO_ROOT/scripts/build.js"
  git add -- "$REPO_ROOT/index.html" "$REPO_ROOT/llms.txt" "$REPO_ROOT/llms-full.txt"
fi
EOF

chmod +x "$DEST"
echo "✓ pre-commit hook installed at $DEST"
echo "  it will auto-rebuild index.html / llms.txt / llms-full.txt"
echo "  whenever you commit changes to content/*.json"
