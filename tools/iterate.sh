#!/usr/bin/env bash
# convert + translate (bash side). Then run tools/build-run.ps1 from PowerShell.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/tools/translate-mod.sh" "$@" | tail -3
