#!/bin/sh
# Installs the version-controlled hooks into .git/hooks.
# Run once per clone:  sh tools/install-hooks.sh
# To remove:           rm .git/hooks/pre-push
set -e
cd "$(git rev-parse --show-toplevel)"
cp tools/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
echo "installed .git/hooks/pre-push"
echo "remove with: rm .git/hooks/pre-push"
