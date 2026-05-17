#!/usr/bin/env python3
import re, sys

path = '/opt/stratus/docker-compose.yml'
with open(path, 'r') as f:
    s = f.read()

# Remove prior corrupted block (the literal \n run we accidentally inserted)
s = re.sub(r'      - STALENESS_ALERTS_ENABLED=.*?\n', '', s, count=1)

# If clean block already present, do nothing
if 'DIGEST_ENABLED=${DIGEST_ENABLED' in s:
    print('Already patched')
    sys.exit(0)

insert = (
    '      - STALENESS_ALERTS_ENABLED=${STALENESS_ALERTS_ENABLED:-false}\n'
    '      - STALENESS_CHECK_INTERVAL=${STALENESS_CHECK_INTERVAL:-900000}\n'
    '      - STALENESS_THRESHOLD=${STALENESS_THRESHOLD:-7200000}\n'
    '      - STALENESS_COOLDOWN=${STALENESS_COOLDOWN:-21600000}\n'
    '      - DIGEST_ENABLED=${DIGEST_ENABLED:-false}\n'
    '      - DIGEST_RECIPIENT=${DIGEST_RECIPIENT:-esterhuizen2k@proton.me}\n'
    '      - DIGEST_CRON=${DIGEST_CRON:-0 7 * * 1,5}\n'
)

needle = '      - APP_BASE_URL=${PUBLIC_URL:-https://stratusweather.co.za}\n'
if needle not in s:
    print('Could not find APP_BASE_URL anchor')
    sys.exit(1)

s = s.replace(needle, needle + insert, 1)
with open(path, 'w') as f:
    f.write(s)
print('OK')
