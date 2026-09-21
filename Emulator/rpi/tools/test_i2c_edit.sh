#!/bin/bash
# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Test: config.txt I2C enable logic used by install.sh and the stager.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
# Exercise install.sh's config.txt handling against the real stock file.
#
# The risk being tested: the stock image ships "#dtparam=i2c_arm=on", so a naive
# `grep dtparam=i2c_arm=on` matches the COMMENTED line and the installer would
# report I2C already enabled while leaving it off. That failure mode produces a
# rig that boots clean and never sees the DAC.
set -u
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1));
       else echo "FAIL  $1"; echo "        expected: $3"; echo "        actual:   $2"; fail=$((fail+1)); fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- the detection and edit, lifted verbatim from install.sh ----------------
apply() {
  local CONFIG_TXT="$1"
  if grep -Eq '^[[:space:]]*dtparam=i2c_arm=on' "$CONFIG_TXT"; then
    echo "already-on"; return
  fi
  if grep -Eq '^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on' "$CONFIG_TXT"; then
    sed -i 's/^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on.*/dtparam=i2c_arm=on/' "$CONFIG_TXT"
    echo "uncommented"; return
  fi
  printf '\n# Added by the lightning emulator installer.\ndtparam=i2c_arm=on\n' >> "$CONFIG_TXT"
  echo "appended"
}

echo "=== 1. stock image config.txt (commented out) ==="
cat > "$TMP/stock.txt" <<'EOF'
# Uncomment some or all of these to enable the optional hardware interfaces
#dtparam=i2c_arm=on
#dtparam=i2s=on
#dtparam=spi=on
dtparam=audio=on
EOF
r=$(apply "$TMP/stock.txt")
ck "stock: reports uncommented" "$r" "uncommented"
ck "stock: active line now present" \
   "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/stock.txt")" "1"
ck "stock: commented line is gone" \
   "$(grep -Ec '^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on' "$TMP/stock.txt")" "0"
ck "stock: i2s left alone" \
   "$(grep -Ec '^#dtparam=i2s=on' "$TMP/stock.txt")" "1"
ck "stock: spi left alone" \
   "$(grep -Ec '^#dtparam=spi=on' "$TMP/stock.txt")" "1"
ck "stock: audio untouched" \
   "$(grep -Ec '^dtparam=audio=on' "$TMP/stock.txt")" "1"

echo
echo "=== 2. idempotence: run again on the result ==="
r=$(apply "$TMP/stock.txt")
ck "second run: reports already-on" "$r" "already-on"
ck "second run: still exactly one active line" \
   "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/stock.txt")" "1"

echo
echo "=== 3. file with no i2c line at all ==="
printf 'dtparam=audio=on\n' > "$TMP/bare.txt"
r=$(apply "$TMP/bare.txt")
ck "bare: reports appended" "$r" "appended"
ck "bare: active line present" \
   "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/bare.txt")" "1"
r=$(apply "$TMP/bare.txt")
ck "bare: idempotent" "$r" "already-on"

echo
echo "=== 4. already enabled by hand, with leading whitespace ==="
printf '   dtparam=i2c_arm=on\n' > "$TMP/ws.txt"
r=$(apply "$TMP/ws.txt")
ck "whitespace: recognised as on" "$r" "already-on"
ck "whitespace: not duplicated" \
   "$(grep -Ec 'dtparam=i2c_arm=on' "$TMP/ws.txt")" "1"

echo
echo "=== 5. commented with a space after the hash ==="
printf '# dtparam=i2c_arm=on\n' > "$TMP/sp.txt"
r=$(apply "$TMP/sp.txt")
ck "hash-space: uncommented" "$r" "uncommented"
ck "hash-space: active line present" \
   "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/sp.txt")" "1"

echo
echo "=== 6. real card file, if reachable ==="
if [ -f /d/config.txt ]; then
  cp /d/config.txt "$TMP/real.txt"
  r=$(apply "$TMP/real.txt")
  # Either answer is correct and which one you get depends on whether the card
  # has already been staged: "uncommented" on a stock card, "already-on" on a
  # staged one. Asserting a specific one makes this test fail the moment staging
  # succeeds, which is backwards. Assert the invariant instead.
  case "$r" in
    uncommented|already-on) ck "real: ends up enabled ($r)" "yes" "yes" ;;
    *)                      ck "real: ends up enabled" "$r" "uncommented or already-on" ;;
  esac
  ck "real: exactly one active i2c_arm line" \
     "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/real.txt")" "1"
  ck "real: no commented i2c_arm left behind" \
     "$(grep -Ec '^[[:space:]]*#[[:space:]]*dtparam=i2c_arm=on' "$TMP/real.txt")" "0"
  ck "real: arm_64bit survived" \
     "$(grep -Ec '^arm_64bit=1' "$TMP/real.txt")" "1"
  ck "real: cm4 section survived" \
     "$(grep -Ec '^\[cm4\]' "$TMP/real.txt")" "1"
  # Re-running must not add a duplicate, whatever state the card was in.
  apply "$TMP/real.txt" > /dev/null
  ck "real: still one active line after a second pass" \
     "$(grep -Ec '^dtparam=i2c_arm=on' "$TMP/real.txt")" "1"
else
  echo "SKIP  /d/config.txt not readable from this shell"
fi

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
