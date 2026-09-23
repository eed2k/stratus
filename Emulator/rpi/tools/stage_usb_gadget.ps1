# =========================================================================
#
#  Stratus AS3935 Lightning Emulator
#  Give the bench card a USB gadget network so it can be reached from a PC.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
#
# The emulator is deliberately never given WiFi, which is correct for a bench
# instrument but leaves no way to inspect it when it will not fire. This adds a
# USB ethernet gadget, so a single cable to a PC presents a network interface and
# nothing about the rig's isolation from the site network changes.
#
# WHAT IT CHANGES ON THE CARD
#
#   config.txt       adds dtoverlay=dwc2,dr_mode=peripheral under [all]
#   cmdline.txt      adds modules-load=dwc2,g_ether, and rewrites the cloud-init
#                    instance id so first-boot provisioning runs again
#   network-config    static address on usb0, since the stock file is entirely
#                    commented out and the interface would otherwise come up with
#                    no address at all
#   user-data        replaces the authorised SSH key with a dedicated bench key
#
# WHY THE INSTANCE ID IS REWRITTEN
#
# cloud-init runs its modules once per instance id. The card carries an id set by
# Raspberry Pi Imager, so if provisioning already ran, install.sh will not run
# again and the emulator service may never have been installed. A new id makes
# cloud-init treat this as a fresh instance and re-run everything. install.sh is
# idempotent by design, so this is safe to repeat.
#
# THE PASSWORD HASH IS LEFT ALONE
#
# ssh_pwauth is false, so the password is not a way in over the network, but it is
# the way in on a keyboard and monitor. That is the fallback if the key is wrong,
# so it stays untouched.
#
# Run with the card's FAT32 boot partition mounted, then put the card back, and
# connect the cable to the Pi's USB port, NOT PWR IN.

[CmdletBinding()]
param(
  [string]$Card = 'D:',
  [string]$PubKeyPath = "$env:USERPROFILE\.ssh\emulator_bench.pub",
  [string]$PiAddress = '10.55.0.1',
  [int]$Prefix = 24
)

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "  $m" }
function Fail($m) { throw $m }

Write-Host '=== IDENTIFY THE CARD ==='

foreach ($f in 'config.txt', 'cmdline.txt', 'user-data', 'network-config') {
  if (-not (Test-Path (Join-Path $Card $f))) {
    Fail "$f missing from $Card. This does not look like the staged boot partition. Refusing to write."
  }
}

$cmdline = (Get-Content (Join-Path $Card 'cmdline.txt') -Raw).Trim()

# Refuse outright to touch the detector's card. Its PARTUUID is known and the
# consequence of confusing the two is a broken production unit.
if ($cmdline -match '3f606ee6-02') {
  Fail 'This is the QUAGGASKLIP DETECTOR card (PARTUUID 3f606ee6-02). Refusing to write.'
}
if (-not (Test-Path (Join-Path $Card 'emulator'))) {
  Fail "No emulator directory on $Card. This is not the emulator card. Refusing to write."
}
Step "emulator payload present, and this is not the detector card"

$partuuid = if ($cmdline -match 'root=PARTUUID=(\S+)') { $Matches[1] } else { 'unknown' }
Step "PARTUUID $partuuid"

if (-not (Test-Path $PubKeyPath)) { Fail "Public key not found: $PubKeyPath" }
$pub = (Get-Content $PubKeyPath -Raw).Trim()
if ($pub -notmatch '^ssh-(ed25519|rsa) ') { Fail 'Public key does not look like an OpenSSH public key.' }
Step "authorising $($pub.Split(' ')[0]) ending $($pub.Split(' ')[1].Substring($pub.Split(' ')[1].Length - 12))"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host ''
Write-Host '=== BACK UP ==='
foreach ($f in 'config.txt', 'cmdline.txt', 'user-data', 'network-config') {
  $src = Join-Path $Card $f
  Copy-Item $src "$src.bak-$stamp" -Force
  Step "$f -> $f.bak-$stamp"
}

Write-Host ''
Write-Host '=== config.txt: USB gadget in peripheral mode ==='
$cfgPath = Join-Path $Card 'config.txt'
$cfg = Get-Content $cfgPath
if ($cfg -match '^\s*dtoverlay=dwc2,dr_mode=peripheral\s*$') {
  Step 'already present, left alone'
} else {
  # Must land under [all] so it is not swallowed by a model-specific section.
  # The stock file has [cm4], [cm5] and [pi5] blocks, and an entry placed after
  # one of those would apply only to that model and silently do nothing here.
  $out = New-Object System.Collections.Generic.List[string]
  $added = $false
  foreach ($line in $cfg) {
    $out.Add($line)
    if (-not $added -and $line.Trim() -eq '[all]') {
      $out.Add('# USB ethernet gadget, so the bench card can be reached over a single')
      $out.Add('# cable. Peripheral mode: the Pi is the device, the PC is the host.')
      $out.Add('dtoverlay=dwc2,dr_mode=peripheral')
      $added = $true
    }
  }
  if (-not $added) {
    $out.Add('[all]')
    $out.Add('dtoverlay=dwc2,dr_mode=peripheral')
  }
  Set-Content $cfgPath ($out -join "`n") -NoNewline -Encoding ascii
  Add-Content $cfgPath "`n" -NoNewline -Encoding ascii
  Step 'added dtoverlay=dwc2,dr_mode=peripheral under [all]'
}

Write-Host ''
Write-Host '=== cmdline.txt: load the gadget, and force provisioning to re-run ==='
$newId = "emulator-usb-$stamp"
$c = $cmdline

if ($c -notmatch 'modules-load=dwc2,g_ether') {
  # The modules must be requested on the kernel command line, immediately after
  # rootwait, which is where the Pi documentation places them.
  if ($c -match '\brootwait\b') {
    $c = $c -replace '\brootwait\b', 'rootwait modules-load=dwc2,g_ether'
  } else {
    $c = "$c modules-load=dwc2,g_ether"
  }
  Step 'added modules-load=dwc2,g_ether'
} else {
  Step 'modules-load already present'
}

if ($c -match 'ds=nocloud;i=([^\s]+)') {
  $c = $c -replace 'ds=nocloud;i=[^\s]+', "ds=nocloud;i=$newId"
  Step "instance id -> $newId  (was $($Matches[1]))"
} else {
  $c = "$c ds=nocloud;i=$newId"
  Step "instance id set to $newId"
}

$c = ($c -split '\s+' | Where-Object { $_ }) -join ' '

# A malformed cmdline.txt does not boot, so verify before writing.
if ($c -notmatch 'root=PARTUUID=') { Fail 'cmdline lost root=PARTUUID. Refusing to write.' }
if ($c -notmatch 'rootfstype=')    { Fail 'cmdline lost rootfstype. Refusing to write.' }
if ($c -match "`n")                { Fail 'cmdline contains a newline. Refusing to write.' }

Set-Content (Join-Path $Card 'cmdline.txt') $c -NoNewline -Encoding ascii
Add-Content (Join-Path $Card 'cmdline.txt') "`n" -NoNewline -Encoding ascii
Step 'written as a single line'

Write-Host ''
Write-Host '=== network-config: an address on usb0 ==='
$netBody = @"
# Static address on the USB ethernet gadget.
#
# The stock file Imager writes is entirely commented out, so usb0 would come up
# with no address and the link would be useless. There is no DHCP server at
# either end of a gadget link, so both sides are fixed by hand.
#
# optional: true matters. Without it systemd-networkd waits for the interface at
# boot, and the Pi would stall for the timeout whenever no cable is plugged in.
#
# Pi   $PiAddress/$Prefix
# PC   set the RNDIS adapter to 10.55.0.2/$Prefix, no gateway
network:
  version: 2
  ethernets:
    usb0:
      dhcp4: false
      dhcp6: false
      optional: true
      addresses:
        - $PiAddress/$Prefix
"@
Set-Content (Join-Path $Card 'network-config') $netBody -Encoding ascii
Step "usb0 fixed at $PiAddress/$Prefix"

Write-Host ''
Write-Host '=== user-data: dedicated bench key ==='
$udPath = Join-Path $Card 'user-data'
$ud = Get-Content $udPath -Raw

$before = ([regex]::Matches($ud, '(?m)^\s*-\s+"ssh-(ed25519|rsa)[^"]*"\s*$')).Count
if ($before -lt 1) { Fail 'Could not find an ssh_authorized_keys entry to replace. Refusing to guess.' }

# Replace every authorised key with exactly one: this card's own. cloud-init
# appends to authorized_keys rather than replacing it, so leaving the old entry
# here would keep the emulator key valid on the unit.
$ud = [regex]::Replace($ud, '(?m)^(\s*)-\s+"ssh-(ed25519|rsa)[^"]*"\s*$', "`$1- `"$pub`"", 1)
$ud = [regex]::Replace($ud, '(?m)^\s*-\s+"ssh-(ed25519|rsa)[^"]*"\s*\r?\n', '', [System.Text.RegularExpressions.RegexOptions]::None)

# The replacement above can also strip the one we just inserted, so verify.
if ($ud -notmatch [regex]::Escape($pub)) {
  $ud = [regex]::Replace($ud, '(?m)^(\s*ssh_authorized_keys:\s*)$', "`$1`n    - `"$pub`"", 1)
}
$after = ([regex]::Matches($ud, 'ssh-(ed25519|rsa) AAAA')).Count
if ($after -ne 1) { Fail "Expected exactly 1 authorised key after edit, found $after. Refusing to write." }
if ($ud -match 'AAAAC3NzaC1lZDI1NTE5AAAAIK1cQ1n3+aa3AYpnUaraJgqeVG/keqbpuzyv1Qmij/ot') {
  Fail 'The emulator key is still present after the edit. Refusing to write.'
}

Set-Content $udPath $ud -Encoding ascii -NoNewline
Add-Content $udPath "`n" -NoNewline -Encoding ascii
Step "replaced $before key(s) with 1 dedicated bench key, emulator key gone"

Write-Host ''
Write-Host '=== VERIFY ==='
Step "cmdline : $(Get-Content (Join-Path $Card 'cmdline.txt') -Raw)".Trim()
Step "dwc2 in config.txt   : $([bool](Select-String -Path $cfgPath -Pattern 'dwc2,dr_mode=peripheral' -Quiet))"
Step "usb0 in network-config: $([bool](Select-String -Path (Join-Path $Card 'network-config') -Pattern 'usb0' -Quiet))"
Step "keys in user-data     : $after"
Step "emulator key present     : $([bool](Select-String -Path $udPath -Pattern 'AAAAIOxe24Ihqo4ZRqAOZAyWTdbEN2YfA0PZfFOxSwU1xUq6' -Quiet))"

Write-Host ''
Write-Host '=== NEXT ==='
Write-Host '  1. Eject the card and put it back in the emulator Pi.'
Write-Host '  2. Power the Pi from PWR IN as usual.'
Write-Host '  3. Connect a second cable from the Pi USB port to the PC.'
Write-Host '  4. On the PC, set the new RNDIS adapter to 10.55.0.2/24, no gateway.'
Write-Host "  5. ssh -i `"$env:USERPROFILE\.ssh\emulator_bench`" emulator1@$PiAddress"
Write-Host ''
Write-Host '  First boot re-runs provisioning, so allow a couple of minutes.'
Write-Host '  The install log will be at /var/log/lightning-emulator-install.log'
