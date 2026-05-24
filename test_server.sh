#!/bin/bash
# Quick smoke-test for SnapBridge server
# Usage: ./test_server.sh https://your-server.onrender.com

BASE="${1:-http://localhost:3000}"
echo "Testing $BASE"

# Health
echo -n "Health: "
curl -sf "$BASE/health" | python3 -m json.tool 2>/dev/null || echo "FAIL"

# Register user A
echo -e "\nRegister userA:"
RESP_A=$(curl -sf -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testA_'$RANDOM'","publicKey":"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest"}')
echo "$RESP_A" | python3 -m json.tool 2>/dev/null

TOKEN_A=$(echo "$RESP_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null)
FRIEND_KEY_A=$(echo "$RESP_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['friendKey'])" 2>/dev/null)
echo "Token A: $TOKEN_A"
echo "Friend Key A: $FRIEND_KEY_A"

# Register user B
echo -e "\nRegister userB:"
RESP_B=$(curl -sf -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testB_'$RANDOM'","publicKey":"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest2"}')
TOKEN_B=$(echo "$RESP_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])" 2>/dev/null)
FRIEND_KEY_B=$(echo "$RESP_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['friendKey'])" 2>/dev/null)
echo "Token B: $TOKEN_B | Friend Key B: $FRIEND_KEY_B"

# B adds A as friend
echo -e "\nB adds A by friend key:"
curl -sf -X POST "$BASE/api/friends/add" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"friendKey\":\"$FRIEND_KEY_A\"}" | python3 -m json.tool 2>/dev/null

# List friends of B
echo -e "\nB's friends:"
curl -sf "$BASE/api/friends" -H "Authorization: Bearer $TOKEN_B" | python3 -m json.tool 2>/dev/null

echo -e "\n✅ Smoke test done"
