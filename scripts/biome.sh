#!/usr/bin/env bash
# Run from the workspace root, including when invoked by mobile/package.json.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BIOME="$ROOT/node_modules/@biomejs/biome/bin/biome"
# The npm native binary needs the Nix development shell's ELF loader on NixOS.
if [[ "$(uname -s)" == Linux && -n "${NIX_LD:-}" ]]; then
  case "$(uname -m)" in
    x86_64) PLATFORM=linux-x64 ;;
    aarch64) PLATFORM=linux-arm64 ;;
    *) exec node "$BIOME" "$@" ;;
  esac
  BINARY="$ROOT/node_modules/@biomejs/biome/node_modules/@biomejs/cli-$PLATFORM/biome"
  if [[ ! -f "$BINARY" ]]; then
    BINARY="$(node -e 'const p = require("node:path"); console.log(require.resolve("@biomejs/cli-" + process.argv[1] + "/biome", { paths: [p.dirname(require.resolve("@biomejs/biome/package.json"))] }))' "$PLATFORM")"
  fi
  exec "$NIX_LD" "$BINARY" "$@"
fi
exec node "$BIOME" "$@"
