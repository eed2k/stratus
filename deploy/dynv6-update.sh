#!/bin/bash
# =============================================================================
# DynV6 Dynamic DNS Update Script
# Run this on the server to keep your DynV6 domain pointed to the server
# =============================================================================

# Configuration - EDIT THESE VALUES
DYNV6_TOKEN="${DYNV6_TOKEN:-your_dynv6_token_here}"
DYNV6_HOSTNAME="${DYNV6_HOSTNAME:-stratus.dynv6.net}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Get current public IP
CURRENT_IP=$(curl -s https://api.ipify.org)

if [ -z "$CURRENT_IP" ]; then
    echo -e "${RED}[ERROR]${NC} Could not determine public IP"
    exit 1
fi

echo "Updating DynV6..."
echo "  Hostname: $DYNV6_HOSTNAME"
echo "  IP: $CURRENT_IP"

# Update DynV6 using their HTTP API
RESPONSE=$(curl -s "https://dynv6.com/api/update?hostname=${DYNV6_HOSTNAME}&ipv4=${CURRENT_IP}&token=${DYNV6_TOKEN}")

if [[ "$RESPONSE" == *"addresses updated"* ]] || [[ "$RESPONSE" == *"addresses unchanged"* ]]; then
    echo -e "${GREEN}[SUCCESS]${NC} DynV6 updated successfully: $RESPONSE"
else
    echo -e "${RED}[ERROR]${NC} DynV6 update failed: $RESPONSE"
    exit 1
fi
