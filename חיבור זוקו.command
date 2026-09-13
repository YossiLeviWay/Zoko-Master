#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/codex-pilot/launch.mjs
