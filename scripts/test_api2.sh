#!/bin/bash
# Test API endpoint after table_name fix
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@stratusweather.co.za","password":"StratusAdmin2024!"}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('token','NONE'))" 2>/dev/null || echo "NONE")

echo "Token: ${TOKEN:0:30}..."

echo ""
echo "=== /api/stations/1/data/latest ==="
LATEST=$(curl -s http://localhost:5000/api/stations/1/data/latest \
  -H "Authorization: Bearer $TOKEN")
echo "$LATEST" | python3 -m json.tool 2>/dev/null | head -40
if echo "$LATEST" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('HAS DATA' if 'data' in d or 'timestamp' in d else 'NO DATA')" 2>/dev/null; then
  :
fi

echo ""
echo "=== /api/stations/1/data?startTime&endTime ==="
START="2026-02-05T00:00:00Z"
END="2026-02-06T00:00:00Z"
curl -s "http://localhost:5000/api/stations/1/data?startTime=$START&endTime=$END" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
data=json.loads(sys.stdin.read())
if isinstance(data, list):
  print(f'Got {len(data)} records')
  if len(data)>0:
    print(f'First: {json.dumps(data[0], indent=2)[:300]}')
elif isinstance(data, dict) and 'data' in data:
  d=data['data']
  print(f'Got {len(d)} records')
  if len(d)>0:
    print(f'First: {json.dumps(d[0], indent=2)[:300]}')
else:
  print(json.dumps(data, indent=2)[:500])
" 2>/dev/null
