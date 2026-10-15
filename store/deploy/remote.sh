#!/bin/sh
# Runs ON the apex host from deploy.sh: build /opt/travel-esim and replace the running storefront,
# keeping the previous container until the new one serves its home page (which needs the catalogue).
set -eu
TAG="$1"; DEMO="$2"
SECRETS=/opt/esim-secrets
DATA=/opt/travel-esim-data
cd /opt/travel-esim
docker build -q -f store/Dockerfile -t "travel-esim:$TAG" . >/dev/null
docker network inspect travel-esim >/dev/null 2>&1 || docker network create travel-esim >/dev/null
mkdir -p "$DATA" && chown 1000:1000 "$DATA" && chmod 700 "$DATA"
docker rm -f travel-esim-prev >/dev/null 2>&1 || true
if docker container inspect travel-esim >/dev/null 2>&1; then docker stop travel-esim >/dev/null; docker rename travel-esim travel-esim-prev; fi
docker run -d --name travel-esim --restart unless-stopped --network travel-esim \
  -p 127.0.0.1:9497:9495 -e PUBLIC_URL=https://esim-shop.modelmarket.dev -e DATA_DIR=/data \
  -e DEMO_MODE="$DEMO" -e STORE_NAME="Travel eSIM · demo" -e KIT_URL=https://esim.modelmarket.dev/ \
  -e KIT_ORIGIN=https://esim.modelmarket.dev \
  -e ESIMACCESS_ACCESS_CODE_FILE=/run/secrets/esim/esimaccess_access_code \
  -e ESIMACCESS_SECRET_KEY_FILE=/run/secrets/esim/esimaccess_secret_key \
  -v "$SECRETS:/run/secrets/esim:ro" -v "$DATA:/data" \
  --read-only --tmpfs /tmp:size=16m --cap-drop ALL --security-opt no-new-privileges --memory 256m \
  "travel-esim:$TAG" >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -o /dev/null http://127.0.0.1:9497/ 2>/dev/null; then
    echo "travel-esim:$TAG healthy (demo=$DEMO)"; exit 0
  fi
  sleep 2
done
echo "travel-esim:$TAG did not become healthy; rolling back" >&2
docker logs --tail 20 travel-esim >&2 || true
docker rm -f travel-esim >/dev/null
docker container inspect travel-esim-prev >/dev/null 2>&1 && docker rename travel-esim-prev travel-esim && docker start travel-esim >/dev/null
exit 1
