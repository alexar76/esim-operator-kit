#!/bin/sh
# Runs ON the apex host from deploy.sh: build /opt/esim-rails and replace the running node, keeping
# the previous container until the new one reports a loaded catalogue on /healthz.
# Secrets are files, mounted read-only for uid 1000 (the image's user); nothing here prints them.
set -eu
TAG="$1"; PAY_TO="$2"; DEMO="${3:-1}"
SECRETS=/opt/esim-secrets
DATA=/opt/esim-node-data
CDP=/opt/okx-a2mcp-secrets/cdp_api_key.json
cd /opt/esim-rails
docker build -q -t "esim-rails:$TAG" . >/dev/null
docker network inspect esim-rails >/dev/null 2>&1 || docker network create esim-rails >/dev/null
mkdir -p "$DATA" && chown 1000:1000 "$DATA" && chmod 700 "$DATA"
chown 1000:1000 "$SECRETS" "$SECRETS"/esimaccess_access_code "$SECRETS"/esimaccess_secret_key
chmod 500 "$SECRETS"; chmod 400 "$SECRETS"/esimaccess_access_code "$SECRETS"/esimaccess_secret_key
PAY=""
[ -f "$CDP" ] && PAY="-e PAY_TO=$PAY_TO -e CDP_KEY_FILE=/run/secrets/cdp.json -v $CDP:/run/secrets/cdp.json:ro"
# The name says what the node is: an agent reads it, and "demo" in the name of a node that sells misleads.
NAME="modelmarket.dev demo seller"; [ "$DEMO" = "0" ] && NAME="modelmarket.dev eSIM seller"
# A selling window: automatic refunds from REFUND_DIR/refund_key (capped low), and an optional margin.
OPT=""
if [ "$DEMO" = "0" ] && [ -n "${REFUND_DIR:-}" ] && [ -f "$REFUND_DIR/refund_key" ]; then
  OPT="$OPT -e REFUND_KEY_FILE=/run/secrets/refund/refund_key -e REFUND_MAX_USD=2 -e REFUND_DAILY_MAX_USD=5 -v $REFUND_DIR:/run/secrets/refund:ro"
fi
[ -n "${MARGIN:-}" ] && OPT="$OPT -e MARGIN_PCT=$MARGIN"
[ -n "${MIN_MARGIN:-}" ] && OPT="$OPT -e MIN_MARGIN_USD=$MIN_MARGIN"
docker rm -f esim-node-prev >/dev/null 2>&1 || true
if docker container inspect esim-node >/dev/null 2>&1; then docker stop esim-node >/dev/null; docker rename esim-node esim-node-prev; fi
# shellcheck disable=SC2086
docker run -d --name esim-node --restart unless-stopped --network esim-rails \
  -p 127.0.0.1:9493:9490 -e PUBLIC_URL=https://modelmarket.dev/providers/esim \
  -e ESIMACCESS_ACCESS_CODE_FILE=/run/secrets/esim/esimaccess_access_code \
  -e ESIMACCESS_SECRET_KEY_FILE=/run/secrets/esim/esimaccess_secret_key \
  -e STATUS_SECRET_FILE=/data/status_secret -e PROVIDER_KEY_FILE=/data/provider_ed25519.pem -e ORDER_STORE=/data/orders.json \
  -e SELLER_NAME="$NAME" -e PRODUCT_ID=esim-modelmarket -e DEMO_MODE="$DEMO" \
  $PAY $OPT -v "$SECRETS:/run/secrets/esim:ro" -v "$DATA:/data" \
  --read-only --tmpfs /tmp:size=16m --cap-drop ALL --security-opt no-new-privileges --memory 256m \
  "esim-rails:$TAG" >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS http://127.0.0.1:9493/healthz 2>/dev/null | grep -q '"ok":true'; then
    echo "esim-rails:$TAG healthy: $(curl -fsS http://127.0.0.1:9493/healthz)"; exit 0
  fi
  sleep 2
done
echo "esim-rails:$TAG did not become healthy; rolling back" >&2
docker logs --tail 20 esim-node >&2 || true
docker rm -f esim-node >/dev/null
docker container inspect esim-node-prev >/dev/null 2>&1 && docker rename esim-node-prev esim-node && docker start esim-node >/dev/null
exit 1
