#!/bin/bash
# Test API endpoint after table_name fix
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"lukas@itronics.co.za","password":"Str@tus2025!"}' \
  | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('token','NONE'))" 2>/dev/null || echo "NONE")

echo "Token: ${TOKEN:0:20}..."

if [ "$TOKEN" = "NONE" ] || [ -z "$TOKEN" ]; then
  echo "Login failed, trying admin..."
  TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@stratus.local","password":"admin123"}' \
    | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('token','NONE'))" 2>/dev/null || echo "NONE")
  echo "Token: ${TOKEN:0:20}..."
fi

echo ""
echo "=== /api/stations/1/data/latest ==="
curl -s http://localhost:5000/api/stations/1/data/latest \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -30

echo ""
echo "=== /api/stations ==="
curl -s http://localhost:5000/api/stations \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -20
