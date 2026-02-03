#!/bin/bash
# Reset admin password

# First, get the bcrypt hash
NODE_SCRIPT='
const bcrypt = require("bcryptjs");
const hash = bcrypt.hashSync("admin123", 10);
console.log(hash);
'

cd /root/stratus

# Generate hash inside the container
HASH=$(docker exec stratus-app node -e "$NODE_SCRIPT" 2>/dev/null)
echo "Generated hash: $HASH"

# Copy database out
docker cp stratus-app:/app/data/stratus.db /tmp/stratus_update.db

# Update password
sqlite3 /tmp/stratus_update.db "UPDATE users SET password_hash = '$HASH' WHERE email = 'esterhuizen2k@proton.me';"

echo "Updated password. Verifying..."
sqlite3 /tmp/stratus_update.db "SELECT email, password_hash FROM users WHERE email = 'esterhuizen2k@proton.me';"

# Copy back
docker cp /tmp/stratus_update.db stratus-app:/app/data/stratus.db

echo "Password reset complete. Testing login..."
sleep 2

# Test login
curl -s -c /tmp/c6.txt -X POST 'http://localhost:5000/api/client/login' -H 'Content-Type: application/json' -d '{"email":"esterhuizen2k@proton.me","password":"admin123"}'
