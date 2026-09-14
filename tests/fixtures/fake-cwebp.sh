#!/bin/sh
# Synthetic stand-in for libwebp's cwebp: -quiet -mt -q N input -o output.
echo "cwebp $*" >> "$TMPDIR/calls"
input="$5"; output="$7"
[ -s "$input" ] || { echo "cannot read input" >&2; exit 1; }
if grep -q NOwebp "$input"; then echo "synthetic failure" >&2; exit 1; fi
printf 'RIFF\000\000\000\000WEBPVP8 ' > "$output"
cat "$input" >> "$output"
exit 0
