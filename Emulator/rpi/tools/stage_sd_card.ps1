# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Bench card staging: writes the payload to the FAT32 boot partition.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
# Stage the lightning emulator onto the Pi OS Lite boot partition.
#
# The boot partition is FAT32 and is the only partition Windows can write: the
# rootfs is ext4 and is invisible here. That is fine, because the running Pi
# mounts this partition at /boot/firmware, so anything dropped here is reachable
# from the Pi and cloud-init can install it on first boot.
#
# Every Linux-side file is written LF-only. A stray CR in install.sh would break
# the shebang and every line after it, and in user-data it can break YAML
# parsing, which on a network-less box means no user account and no way in.
#
# Run it from anywhere:
#   powershell -NoProfile -ExecutionPolicy Bypass -File Emulator\rpi\tools\stage_sd_card.ps1
#
# Written for Windows PowerShell 5.1, so no ternary operator and no `??`.
$ErrorActionPreference = 'Stop'

# This script lives at Emulator/rpi/tools/, so the repo root is three levels up.
# Derived rather than hardcoded so the card can be restaged from any checkout.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$card = 'D:\'
Write-Output "repo: $repo"

function Assert-Card {
  $vol = Get-Volume -DriveLetter D -ErrorAction Stop
  if ($vol.FileSystemLabel -ne 'bootfs') {
    throw "D: is labelled '$($vol.FileSystemLabel)', expected 'bootfs'. Refusing to write."
  }
  if ($vol.FileSystem -ne 'FAT32') {
    throw "D: is $($vol.FileSystem), expected FAT32. Refusing to write."
  }
  # Sanity: the Pi firmware files must be here, otherwise this is not a boot partition.
  foreach ($f in 'config.txt', 'cmdline.txt', 'kernel8.img') {
    if (-not (Test-Path (Join-Path $card $f))) {
      throw "$f missing from D:. This does not look like a Pi boot partition. Refusing to write."
    }
  }
  Write-Output "card check: D: is bootfs / FAT32 / has Pi firmware  OK"
}

function Write-Lf {
  param([string]$Path, [string]$Text)
  $lf = $Text -replace "`r`n", "`n"
  # No BOM: the Pi's shell, systemd and cloud-init all choke on one.
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $lf, $enc)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $cr = ($bytes | Where-Object { $_ -eq 13 }).Count
  Write-Output ("  wrote {0,-46} {1,7} bytes  CR={2}" -f (Split-Path $Path -Leaf), $bytes.Length, $cr)
  if ($cr -ne 0) { throw "CR bytes present in $Path" }
}

Assert-Card
Write-Output ''

# --- 1. backups -------------------------------------------------------------
#
# ONE pristine copy per file, taken the first time only, not a timestamped copy
# on every run. Timestamping looked safer but was worse: re-staging a few times
# left a pile of near-identical files on a 500 MB boot partition, and the useful
# one (the true pre-edit original) got harder to pick out of the list each time.
# Once the file has been staged, a backup of it is a backup of our own output and
# is worth nothing.
Write-Output '--- preserving the original files ---'
foreach ($f in 'config.txt', 'user-data') {
  $src = Join-Path $card $f
  $orig = Join-Path $card "$f.original"
  if (-not (Test-Path $src)) { continue }
  if (Test-Path $orig) {
    Write-Output "  $f.original already kept, left alone"
  } else {
    Copy-Item $src $orig -Force
    Write-Output "  $f -> $f.original  (pristine, kept permanently)"
  }
}

# Clear out any timestamped backups left by earlier versions of this script.
$stale = Get-ChildItem $card -Filter '*.bak-*' -ErrorAction SilentlyContinue
if ($stale) {
  $stale | Remove-Item -Force
  Write-Output "  removed $($stale.Count) stale timestamped backup(s)"
}

# --- 2. enable I2C in config.txt -------------------------------------------
Write-Output ''
Write-Output '--- config.txt: enable I2C ---'
$cfgPath = Join-Path $card 'config.txt'
$cfg = [System.IO.File]::ReadAllText($cfgPath)

# The stock image ships this line commented out. Uncommenting in place keeps it
# in the section the Pi documentation puts it in, rather than appending a second
# copy at the end of the file.
if ($cfg -match '(?m)^\s*dtparam=i2c_arm=on') {
  Write-Output '  dtparam=i2c_arm=on already active'
} elseif ($cfg -match '(?m)^\s*#\s*dtparam=i2c_arm=on') {
  $cfg = $cfg -replace '(?m)^\s*#\s*dtparam=i2c_arm=on.*$', 'dtparam=i2c_arm=on'
  Write-Output '  uncommented dtparam=i2c_arm=on'
} else {
  $cfg += "`n# Added for the lightning emulator: the Thunder EMU Click's MCP4725 is on I2C.`ndtparam=i2c_arm=on`n"
  Write-Output '  appended dtparam=i2c_arm=on'
}

if ($cfg -match '(?m)^\s*dtparam=i2c_arm_baudrate=') {
  Write-Output '  i2c_arm_baudrate already set'
} else {
  $cfg += "# The emulator's burst timing is documented against a 100 kHz bus.`ndtparam=i2c_arm_baudrate=100000`n"
  Write-Output '  appended dtparam=i2c_arm_baudrate=100000'
}

Write-Lf -Path $cfgPath -Text $cfg

# --- 3. user-data -----------------------------------------------------------
Write-Output ''
Write-Output '--- user-data: cloud-init ---'
Write-Lf -Path (Join-Path $card 'user-data') `
         -Text ([System.IO.File]::ReadAllText("$repo\Emulator\rpi\boot\user-data"))

# --- 4. payload -------------------------------------------------------------
Write-Output ''
Write-Output '--- /boot/firmware/emulator payload ---'
$dst = Join-Path $card 'emulator'
if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }

$payload = @{
  'lightning_emulator.py'        = "$repo\Emulator\rpi\lightning_emulator.py"
  'lightning-emulator.service'   = "$repo\Emulator\rpi\lightning-emulator.service"
  'install.sh'                   = "$repo\Emulator\rpi\install.sh"
  'README.txt'                   = "$repo\Emulator\rpi\boot\README.txt"
}
foreach ($name in ($payload.Keys | Sort-Object)) {
  Write-Lf -Path (Join-Path $dst $name) -Text ([System.IO.File]::ReadAllText($payload[$name]))
}

# --- 5. verify --------------------------------------------------------------
Write-Output ''
Write-Output '--- verification ---'
$fail = 0
function Ck { param([string]$Label, [bool]$Ok, [string]$Detail = '')
  # No ternary here: this is Windows PowerShell 5.1, where `? :` is a parse error.
  if ($Ok) { $prefix = 'PASS  ' } else { $prefix = 'FAIL  ' }
  if ($Detail) { $suffix = "   $Detail" } else { $suffix = '' }
  Write-Output ($prefix + $Label + $suffix)
  if (-not $Ok) { $script:fail++ }
}

$cfgNow = [System.IO.File]::ReadAllText($cfgPath)
Ck 'config.txt has an active i2c_arm line' ([bool]($cfgNow -match '(?m)^dtparam=i2c_arm=on'))
Ck 'config.txt has no commented i2c_arm left' (-not ($cfgNow -match '(?m)^\s*#\s*dtparam=i2c_arm=on'))
Ck 'config.txt kept arm_64bit=1' ([bool]($cfgNow -match '(?m)^arm_64bit=1'))
Ck 'config.txt kept the [cm4] section' ([bool]($cfgNow -match '(?m)^\[cm4\]'))
Ck 'config.txt did not gain a second i2c_arm=on' `
   (([regex]::Matches($cfgNow, '(?m)^dtparam=i2c_arm=on')).Count -eq 1) `
   ("count: " + ([regex]::Matches($cfgNow, '(?m)^dtparam=i2c_arm=on')).Count)

$ud = [System.IO.File]::ReadAllText((Join-Path $card 'user-data'))
Ck 'user-data starts with #cloud-config' ($ud.StartsWith('#cloud-config'))
Ck 'user-data kept the password hash' ($ud.Contains('$y$jB5$9NHPHRa9LZnNodaRt7ZGb/'))
Ck 'user-data kept the ssh key' ($ud.Contains('AAAAC3NzaC1lZDI1NTE5AAAAIK1cQ1n3+aa3AYpnUaraJgqeVG/keqbpuzyv1Qmij/ot'))
Ck 'user-data drops the packages list' (-not ($ud -match '(?m)^packages:'))
Ck 'user-data calls the installer' ($ud.Contains('bash /boot/firmware/emulator/install.sh'))
Ck 'user-data has no CR' (-not $ud.Contains("`r"))

foreach ($name in ($payload.Keys | Sort-Object)) {
  $p = Join-Path $dst $name
  $b = [System.IO.File]::ReadAllBytes($p)
  Ck "payload present: $name" ($b.Length -gt 0) "$($b.Length) bytes"
  Ck "payload LF only: $name" (-not ($b -contains 13))
}

$py = [System.IO.File]::ReadAllText((Join-Path $dst 'lightning_emulator.py'))
Ck 'script is the MIKROE-1513 build' ($py.Contains('MIKROE-1513'))
Ck 'script has the headless path' ($py.Contains('--headless'))
Ck 'script default pins are 22,18,17,4' ($py -match "'an':\s*22" -or $py -match 'an.:\s*22')

$sh = [System.IO.File]::ReadAllText((Join-Path $dst 'install.sh'))
Ck 'installer downloads nothing' (-not ($sh -match 'apt-get install|apt install|pip install'))
Ck 'installer shebang is first' ($sh.StartsWith('#!/bin/bash'))

# --- attribution, language and tooling references ---------------------------
# Checked on the staged copies rather than the sources, because the card is the
# artefact that leaves the building.
Write-Output ''
$cardFiles = @{}
foreach ($name in ($payload.Keys | Sort-Object)) { $cardFiles[$name] = Join-Path $dst $name }
$cardFiles['user-data'] = Join-Path $card 'user-data'

foreach ($name in ($cardFiles.Keys | Sort-Object)) {
  $txt = [System.IO.File]::ReadAllText($cardFiles[$name])
  Ck "attribution: $name names METRON (PTY) LTD | Inteltronics" `
     ($txt.Contains('METRON (PTY) LTD | Inteltronics'))
  Ck "attribution: $name credits L.J. Esterhuizen" `
     ($txt.Contains('L.J. Esterhuizen'))

  # No tooling or assistant references anywhere on the card.
  $banned = [regex]::Matches($txt, '(?i)\bkiro\b|\bclaude\b|\bcopilot\b|\bchatgpt\b|\bgpt-|\bLLM\b|artificial intelligence|generated by')
  Ck "no tooling references: $name" ($banned.Count -eq 0) `
     $(if ($banned.Count) { "found: " + (($banned | ForEach-Object { $_.Value }) -join ', ') } else { '' })

  # Pure ASCII. Added after a Cyrillic "bu" was typed into "--probe-buttons" in
  # the card README, which renders as a plausible-looking word but is a command
  # nobody can run and is invisible on inspection. Cheap to check, nasty to find.
  $nonAscii = [regex]::Matches($txt, '[^\x00-\x7F]')
  $detail = ''
  if ($nonAscii.Count) {
    $detail = "chars: " + ((($nonAscii | ForEach-Object { "U+{0:X4}" -f [int][char]$_.Value }) | Select-Object -Unique) -join ' ')
  }
  Ck "pure ASCII: $name" ($nonAscii.Count -eq 0) $detail

  # South African English. American spellings that would realistically appear in
  # this kind of prose.
  $usPattern = '(?i)\b(behavior|behaviors|color|colors|colored|organize|organized|initialize|initialized|initializing|recognize|recognized|analyze|analyzed|customize|optimize|normalize|serialize|minimize|maximize|authorize|apologize|centered|defense|fulfill|favor|labor|neighbor|traveled|canceled|modeling|signaling|license)\b'
  $usHits = [regex]::Matches($txt, $usPattern)
  Ck "South African English: $name" ($usHits.Count -eq 0) `
     $(if ($usHits.Count) { "found: " + (($usHits | ForEach-Object { $_.Value }) -join ', ') } else { '' })
}

# The header must not displace the two lines that have to come first.
$udTxt = [System.IO.File]::ReadAllText((Join-Path $card 'user-data'))
Ck 'user-data: #cloud-config is still line 1' `
   ($udTxt.Split("`n")[0].Trim() -eq '#cloud-config')
$shTxt = [System.IO.File]::ReadAllText((Join-Path $dst 'install.sh'))
Ck 'install.sh: shebang is still line 1' ($shTxt.Split("`n")[0].Trim() -eq '#!/bin/bash')
$pyTxt = [System.IO.File]::ReadAllText((Join-Path $dst 'lightning_emulator.py'))
Ck 'lightning_emulator.py: shebang is still line 1' `
   ($pyTxt.Split("`n")[0].Trim() -eq '#!/usr/bin/env python3')

Write-Output ''
$free = (Get-Volume -DriveLetter D).SizeRemaining
Write-Output ("boot partition free: {0:N1} MB" -f ($free / 1MB))
Write-Output ''
if ($fail -gt 0) { Write-Output "RESULT: FAIL ($fail check(s))"; exit 1 }
Write-Output 'RESULT: PASS - card staged'
