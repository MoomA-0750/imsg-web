#!/bin/sh
# Synthetic stand-in for macOS sips. Never reads real data. What it does is
# chosen by markers in the input file; every call is counted in $TMPDIR/calls.
echo "$*" >> "$TMPDIR/calls"
if [ "$1" = "-g" ]; then
  if grep -q BIG "$5"; then printf '  pixelWidth: 4032\n  pixelHeight: 3024\n'; else printf '  pixelWidth: 640\n  pixelHeight: 480\n'; fi
  exit 0
fi
format="$3"; shift 3
resample=none
if [ "$1" = "-Z" ]; then resample="$2"; shift 2; fi
input="$1"; output="$3"
if grep -q HANG "$input"; then sleep 30; fi
# Like sips: a failure still exits 0 and simply writes nothing.
if grep -q "NO$format" "$input"; then exit 0; fi
case "$format" in
  avif) printf '\000\000\000\034ftypavif' > "$output" ;;
  jpeg) printf '\377\330\377\340' > "$output" ;;
esac
printf 'resample=%s' "$resample" >> "$output"
exit 0
