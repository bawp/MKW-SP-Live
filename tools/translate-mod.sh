#!/usr/bin/env bash
# Re-run the converter and the WiiCompiled mod translation in the sandbox workspace.
#   MKWSP_VARIANT=rankings tools/translate-mod.sh [--base]   builds the Rankings fork (tools/rankings.js)
#                                                            in sandbox-rankings/ instead of sandbox/, and
#                                                            updates out/nand-rankings (tools/rankings-ui.js)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${MKWSP_VARIANT:-}" = "rankings" ]; then
  OUT="$ROOT/build/MKW-SP-Rankings"; SANDBOX="$ROOT/sandbox-rankings"; CONVERT_FLAGS="--rankings"
else
  OUT="$ROOT/build/MKW-SP"; SANDBOX="$ROOT/sandbox"; CONVERT_FLAGS=""
fi
node "$ROOT/tools/convert.js" "$OUT" $CONVERT_FLAGS | grep -E 'WARN|UNRESOLVED|CONFLICT|rewrites|noreturn|kamek blob|rankings: game' || true
node "$ROOT/tools/verify.js" "$OUT/Binaries/Code.pul" | tail -2
# Rankings fork UI data: 7-button after-time-trial menu in the fork's NAND (tools/rankings-ui.js).
if [ "${MKWSP_VARIANT:-}" = "rankings" ]; then node "$ROOT/tools/rankings-ui.js"; fi
WS="$SANDBOX/BuildWorkspace"; cp "$OUT/Binaries/Code.pul" "$WS/PulsarPacks/completed/MKW-SP/Binaries/Code.pul"
W="$(cd "$WS" && pwd -W)"; T="$APPDATA/CT-MKWII/Recomp/Install/Toolkit/Translator/Translator.Cli.exe"
cd "$WS"
if [ "$1" = "--base" ]; then
  "$T" translate-recursive 0x800060A4 --project "$W/projects/mkwii/recomp.yml" --outdir "$W/generated/functions" --output-metadata "$W/generated/base_translation_output.json" --production-source-bundle "$W/generated/base_translation_sources.bin" --no-function-files --prune-stale --threads 16 > "$SANDBOX/translate-base.log" 2>&1
  "$T" emit-base-manifest --project "$W/projects/mkwii/recomp.yml" --out "$W/build/base" --functions-dir "$W/generated/functions" --translation-output-metadata "$W/generated/base_translation_output.json" --region P > "$SANDBOX/emit-manifest.log" 2>&1
else
  "$T" check-base-mod-awareness --project "$W/projects/mkwii/recomp.yml" --profile mkw-sp --translation-output-metadata "$W/generated/base_translation_output.json" --code-pul "$W/PulsarPacks/completed/MKW-SP/Binaries/Code.pul" || { echo "base is stale: rerun with --base"; exit 2; }
fi
set +e
"$T" translate-mod --project "$W/projects/mkwii/recomp.yml" --profile mkw-sp --base-manifest "$W/build/base/mkwii_base_manifest.json" --base-translation-output-metadata "$W/generated/base_translation_output.json" --code-pul "$W/PulsarPacks/completed/MKW-SP/Binaries/Code.pul" --mod-root "$W/PulsarPacks/completed/MKW-SP" --mod-name "MKW-SP" --region P --out "$W/build/mods/mkw_sp_full_cpp" --prefer-cached-inputs --emit-cpp --threads 16 --skip-retro-wfc > "$SANDBOX/translate-mod.log" 2>&1
rc=$?; echo "translate-mod exit $rc"; grep -E 'unresolved|failures|emitted|overlay functions|module patches' "$SANDBOX/translate-mod.log"; exit $rc
