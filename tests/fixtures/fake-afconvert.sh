#!/bin/sh
# Synthetic stand-in for macOS afconvert. Never reads real data. What it does is
# chosen by markers in the input file; every call is counted in $TMPDIR/calls.
echo "afconvert $*" >> "$TMPDIR/calls"
# Fixed argv: -f <format> -d <codec> -b <rate> <input> <output>
input=""
output=""
for arg in "$@"; do
  case "$arg" in
    -*) previous="$arg" ;;
    *)
      case "$previous" in
        -f|-d|-b) previous="" ;;
        *) if [ -z "$input" ]; then input="$arg"; else output="$arg"; fi ;;
      esac
      ;;
  esac
done
if grep -aq HANG "$input" 2>/dev/null; then sleep 30; fi
# Like afconvert: bytes it cannot read are an error, and nothing is written.
if ! grep -aq SOUND "$input" 2>/dev/null; then echo "Error: Couldn't open input file" >&2; exit 1; fi
# An m4a begins with a box length and `ftyp`, then the brand the sniffer looks for.
printf '\0\0\0\034ftypM4A ' > "$output"
grep -ao 'SOUND[A-Z]*' "$input" | head -1 >> "$output"
exit 0
