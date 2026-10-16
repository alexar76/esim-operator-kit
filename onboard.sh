#!/usr/bin/env bash
# The eSIM operator kit, from a fresh server to a store, a seller node for AI agents and a place in the
# federation, in one command. Safe to run again: every step checks what is already done.
#
#   ./onboard.sh                 store + seller node + federation node, in demo mode (sells nothing yet)
#   ./onboard.sh --hub           the same with your own hub instead of the federation node
#   ./onboard.sh --no-announce   do everything but knock on modelmarket.dev
#   ./onboard.sh --check         change nothing: say what is ready and what is missing
#
# Ports 80 and 443 already taken by your web server? It offers to put the kit behind it (nginx: it
# writes the site and gets the certificate with certbot, after asking) instead of the kit's Caddy.
#
# It asks only for what is missing: your domain, the store's name, and the wholesaler's keys (typed in
# hidden, written to secrets/, never printed). Every step is explained in docs/<lang>/operator-guide.md
# and docs/<lang>/own-hub.md, for anyone who would rather do it by hand.
set -euo pipefail
cd "$(dirname "$0")"

FEDERATION_HUB="${ONBOARD_FEDERATION_HUB:-https://modelmarket.dev}"
MODE= ANNOUNCE=ask CHECK_ONLY=0 CHECK_ERRORS=0
for a in "$@"; do
  case "$a" in
    --hub) MODE=hub ;;
    --node) MODE=node ;;
    --no-announce) ANNOUNCE=no ;;
    --announce) ANNOUNCE=yes ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then G=$'\e[32m' R=$'\e[31m' Y=$'\e[33m' B=$'\e[1m' D=$'\e[2m' N=$'\e[0m'; else G= R= Y= B= D= N=; fi
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$N"; }
ask()  { local q="$1" def="${2:-}" v; read -r -p "  $q${def:+ [$def]}: " v; printf '%s' "${v:-$def}"; }
yes_no() { local v; read -r -p "  $1 [Y/n] " v; case "$v" in n|N|no|No) return 1 ;; *) return 0 ;; esac; }

SUDO=""
[ "$(id -u)" = 0 ] || SUDO="sudo"
DC="docker compose"

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {  # replace or append KEY=VALUE in .env, keeping everything else as it is
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^#? ?$k=" .env; then
    awk -v k="$k" -v v="$v" 'BEGIN{done=0} { if (!done && $0 ~ "^#? ?" k "=") { print k "=" v; done=1 } else print }' .env > "$tmp"
  else
    cat .env > "$tmp"; printf '%s=%s\n' "$k" "$v" >> "$tmp"
  fi
  cat "$tmp" > .env && rm -f "$tmp"
}
secret_put() {  # hidden prompt → secrets/<file>, owned by the containers' user
  local file="$1" prompt="$2" v
  printf '  %s: ' "$prompt"; read -rs v; echo
  [ -n "$v" ] || fail "empty value for $prompt"
  ( umask 077; printf '%s' "$v" > "secrets/$file" ); unset v
  $SUDO chown 1000:1000 "secrets/$file"; $SUDO chmod 600 "secrets/$file"
}
CURL_K=""; [ "${ONBOARD_INSECURE:-0}" = 1 ] && CURL_K="-k"   # tests only: a local CA instead of Let's Encrypt
url_ok() { curl -fsS $CURL_K --max-time 10 "$1" >/dev/null 2>&1; }
json_field() { sed -n "s/.*\"$1\":\"\\{0,1\\}\\([^\",}]*\\).*/\\1/p" | head -1; }

# ── HTTPS in front: the kit's Caddy, or the web server you already run ─────────────────────
# PROXY in .env: caddy (default), nginx (your nginx; this script writes the site and runs certbot,
# after asking), external (any other server: the routes are printed for you to add).
STORE_PORT=19495 RAILS_PORT=19490 NODE_PORT=19090 HUB_PORT=19083
write_override() {  # publish the kit's services on 127.0.0.1 for your web server; keep Caddy off
  if [ -f docker-compose.override.yml ] && ! grep -q 'onboard.sh' docker-compose.override.yml; then
    warn "docker-compose.override.yml is yours: make sure it publishes store $STORE_PORT, rails $RAILS_PORT, node $NODE_PORT, hub $HUB_PORT on 127.0.0.1"
    return
  fi
  cat > docker-compose.override.yml <<YAML
# Written by onboard.sh (PROXY=$PROXY): your web server is in front of the kit, so its services are
# published on 127.0.0.1 for it and the kit's Caddy stays off. Delete this file to go back to Caddy.
services:
  store: { ports: ["127.0.0.1:$STORE_PORT:9495"] }
  rails: { ports: ["127.0.0.1:$RAILS_PORT:9490"] }
  node:  { ports: ["127.0.0.1:$NODE_PORT:9090"] }
  hub:   { ports: ["127.0.0.1:$HUB_PORT:9083"] }
  caddy: { profiles: [caddy] }
YAML
  ok "docker-compose.override.yml: the services on 127.0.0.1 for your web server"
}
nginx_locations() {  # the same routes as the kit's Caddyfile
  local fed="$1"
  cat <<NGX
# Written by onboard.sh for $DOMAIN: the eSIM operator kit's routes (see Caddyfile). Rewritten when
# you switch between the federation node and your own hub; the server block that includes it is yours.
proxy_http_version 1.1;
proxy_set_header Host \$host;
proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto \$scheme;
proxy_buffer_size 16k;
proxy_buffers 8 16k;
client_max_body_size 1m;
location = /.well-known/ai-market.json { proxy_pass http://127.0.0.1:$fed; }
location = /.well-known/agent-card.json { proxy_pass http://127.0.0.1:$fed; }
location ^~ /ai-market/ { proxy_pass http://127.0.0.1:$fed; proxy_read_timeout 75s; }
location ^~ /a2a { proxy_pass http://127.0.0.1:$fed; }
location ^~ /mcp { proxy_pass http://127.0.0.1:$fed; }
location ^~ /agents/ { proxy_pass http://127.0.0.1:$RAILS_PORT/; proxy_read_timeout 90s; }
location / { proxy_pass http://127.0.0.1:$STORE_PORT; }
NGX
}
front_reload() {  # after the federation side changed: point HTTPS at it
  local fed=$NODE_PORT; [ "$MODE" = hub ] && fed=$HUB_PORT
  case "$PROXY" in
    caddy) $DC up -d caddy ;;
    nginx)
      local snip="/etc/nginx/snippets/esim-kit-$DOMAIN.locations" site="/etc/nginx/sites-available/esim-kit-$DOMAIN.conf"
      nginx_locations "$fed" | $SUDO tee "$snip" >/dev/null
      if [ ! -f "$site" ]; then
        printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    include snippets/esim-kit-%s.locations;\n}\n' "$DOMAIN" "$DOMAIN" | $SUDO tee "$site" >/dev/null
        $SUDO ln -sf "$site" "/etc/nginx/sites-enabled/esim-kit-$DOMAIN.conf"
      fi
      $SUDO nginx -t >/dev/null 2>&1 || { $SUDO nginx -t; fail "nginx refused the site: see above"; }
      $SUDO systemctl reload nginx
      ok "nginx serves $DOMAIN ($site)"
      if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        command -v certbot >/dev/null || fail "certbot is missing: apt install certbot python3-certbot-nginx"
        if yes_no "Get a Let's Encrypt certificate for $DOMAIN with certbot (you accept the Let's Encrypt terms)?"; then
          if ls /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory/* >/dev/null 2>&1; then
            $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --redirect
          else
            email="$(ask "An email for Let's Encrypt's expiry notices" "$(env_get STORE_CONTACT)")"
            $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --redirect --agree-tos -m "$email"
          fi
        else
          fail "HTTPS is needed: run certbot --nginx -d $DOMAIN yourself, then ./onboard.sh again"
        fi
      fi ;;
    *)
      step "Add these routes to your web server for https://$DOMAIN, then run ./onboard.sh again"
      nginx_locations "$fed" | sed 's/^/  /'
      [ "${ONBOARD_ROUTES_DONE:-0}" = 1 ] || exit 0 ;;
  esac
}

# ── 1. The server ───────────────────────────────────────────────────────────────────────────
step "1. The server"
command -v docker >/dev/null || fail "Docker is not installed: https://docs.docker.com/engine/install/"
$DC version >/dev/null 2>&1 || fail "docker compose is missing (Docker 24 or later ships it)"
command -v curl >/dev/null || fail "curl is missing (apt install curl)"
ok "docker compose $($DC version --short 2>/dev/null)"
PROXY_NOTE=""

# ── 2. Your settings ────────────────────────────────────────────────────────────────────────
step "2. Your settings (.env)"
if [ ! -f .env ]; then
  [ "$CHECK_ONLY" = 1 ] && fail ".env is missing"
  cp .env.example .env && chmod 600 .env
fi
DOMAIN="$(env_get DOMAIN)"; STORE_NAME="$(env_get STORE_NAME)"; PRODUCT_ID="$(env_get PRODUCT_ID)"
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "esim.example.com" ]; then
  [ "$CHECK_ONLY" = 1 ] && fail "DOMAIN is not set in .env"
  DOMAIN="$(ask "Your domain, without https:// (its A record points at this server)")"
  DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "not a domain: $DOMAIN"
  env_set DOMAIN "$DOMAIN"
fi
if [ -z "$STORE_NAME" ] || [ "$STORE_NAME" = "My Travel eSIM" ]; then
  [ "$CHECK_ONLY" = 1 ] || { STORE_NAME="$(ask "Your store's name, as buyers see it" "${STORE_NAME:-My Travel eSIM}")"; env_set STORE_NAME "$STORE_NAME"; }
fi
if [ -z "$PRODUCT_ID" ] || [ "$PRODUCT_ID" = "esim-mytravel" ]; then
  guess="esim-$(printf '%s' "${DOMAIN%%.*}" | tr -c 'A-Za-z0-9-' '-' | tr 'A-Z' 'a-z' | sed 's/-*$//')"
  [ "$guess" = "esim-esim" ] && guess="esim-$(printf '%s' "$DOMAIN" | cut -d. -f2 | tr 'A-Z' 'a-z')"
  [ "$CHECK_ONLY" = 1 ] || { PRODUCT_ID="$(ask "A short id for your offers in the federation" "$guess")"; env_set PRODUCT_ID "$PRODUCT_ID"; }
fi
[[ "$PRODUCT_ID" =~ ^[a-z0-9][a-z0-9-]{2,63}$ ]] || fail "PRODUCT_ID must be letters, digits and dashes: $PRODUCT_ID"
[ -n "$MODE" ] || { MODE=node; [ "$(env_get FEDERATION_UPSTREAM)" != hub:9083 ] || MODE=hub; }
if [ -z "$(env_get DEMO_MODE)" ]; then
  [ "$CHECK_ONLY" = 0 ] || fail "DEMO_MODE is not set; choose 1 (demo) or 0 (live) explicitly"
  env_set DEMO_MODE 1
fi
case "$(env_get DEMO_MODE)" in 0|1) ;; *) fail "DEMO_MODE must be 0 or 1" ;; esac
ok "$DOMAIN · $STORE_NAME · $PRODUCT_ID · $( [ "$(env_get DEMO_MODE)" = 1 ] && echo "demo mode (sells nothing yet)" || echo "selling")"

PROXY="$(env_get PROXY)"
if [ -z "$PROXY" ]; then
  PROXY=caddy
  who="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | sort -u | tr '\n' ' ')"
  if [ -n "$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null)" ]; then
    [ "$CHECK_ONLY" = 1 ] && fail "ports 80/443 are taken (${who:-another web server}) and PROXY is not set in .env"
    if command -v nginx >/dev/null && yes_no "Ports 80 and 443 are taken by ${who:-another web server}. Put the kit behind your nginx instead of the kit's Caddy?"; then
      PROXY=nginx
    elif yes_no "Put the kit behind your own web server (you configure it; the routes are printed)?"; then
      PROXY=external
    else
      fail "free ports 80 and 443 for the kit's Caddy, or answer yes"
    fi
  fi
  [ "$CHECK_ONLY" = 1 ] || env_set PROXY "$PROXY"
fi
case "$PROXY" in
  caddy) front="the kit's Caddy (Let's Encrypt)" ;;
  nginx) front="your nginx (certbot)" ;;
  *) front="your own web server" ;;
esac
ok "HTTPS in front: $front"

ip="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
[ -n "$ip" ] && ok "$DOMAIN resolves to $ip" || warn "$DOMAIN does not resolve yet: create its A record, or HTTPS cannot be issued"

# ── 3. The wholesaler's keys ────────────────────────────────────────────────────────────────
step "3. Keys (secrets/, typed in hidden)"
[ "$CHECK_ONLY" = 1 ] || mkdir -p secrets
SUPPLIER="$(env_get SUPPLIER)"; SUPPLIER="${SUPPLIER:-esimaccess}"
need_secret() {  # file, prompt
  if [ -s "secrets/$1" ]; then ok "secrets/$1"
  elif [ "$CHECK_ONLY" = 1 ]; then warn "secrets/$1 is missing"; CHECK_ERRORS=$((CHECK_ERRORS + 1))
  else secret_put "$1" "$2" && ok "secrets/$1 written"; fi
}
case "$SUPPLIER" in
  esimaccess) need_secret esimaccess_access_code "eSIM Access AccessCode"
              need_secret esimaccess_secret_key "eSIM Access SecretKey" ;;
  airalo)     need_secret airalo_client_id "Airalo client id"; need_secret airalo_client_secret "Airalo client secret" ;;
  esimgo)     need_secret esimgo_api_key "eSIM Go API key" ;;
  http)       [ -n "$(env_get SUPPLIER_URL)" ] || fail "SUPPLIER=http needs SUPPLIER_URL in .env (docs: integrations)"
              need_secret supplier_secret "Your supplier HTTP shared secret" ;;
  *)          fail "SUPPLIER must be esimaccess, airalo, esimgo or http" ;;
esac
[ -s secrets/cdp_api_key.json ] && ok "secrets/cdp_api_key.json (agents can pay you over x402)" \
  || warn "no secrets/cdp_api_key.json: fine in demo mode; needed to sell to agents (operator guide, step 8)"

# ── 4. Folders the containers write ─────────────────────────────────────────────────────────
step "4. Folders"
if [ "$CHECK_ONLY" = 0 ]; then
  mkdir -p data/store data/rails data/node data/hub data/caddy
  $SUDO chown -R 1000:1000 data/store data/rails data/node data/hub
  for f in secrets/*; do
    if [ -f "$f" ] && [ "$(basename "$f")" != README.md ]; then $SUDO chown 1000:1000 "$f"; $SUDO chmod 600 "$f"; fi
  done
  ok "data/ and secrets/ belong to the containers' user (1000)"
fi

if [ "$CHECK_ONLY" = 1 ]; then
  [ "$CHECK_ERRORS" = 0 ] || fail "$CHECK_ERRORS required secret(s) missing; nothing changed"
  $DC config --quiet || fail "docker compose configuration is invalid"
  BASE="${ONBOARD_URL:-https://$DOMAIN}"
  health="$(curl -fsS $CURL_K --max-time 10 "$BASE/agents/healthz" || true)"
  case "$health" in *'"ok":true'*) ;; *) fail "seller health check failed at $BASE/agents/healthz" ;; esac
  if [ "$(env_get DEMO_MODE)" = 0 ]; then
    # Health reports actual agent-payment readiness, not just the presence of a key file.
    case "$health" in *'"paid_orders":true'*) ok "agent payments configured" ;; *) warn "agent payments are off (PAY_TO_EVM / CDP key); check storefront payment methods separately" ;; esac
  fi
  step "Checks passed: configuration, required secrets and seller health. No payment was tested. Nothing changed."
  exit 0
fi

# ── 5. Store and seller node ────────────────────────────────────────────────────────────────
step "5. Store, seller node and HTTPS"
if [ "$PROXY" = caddy ]; then
  $DC up -d --build store rails caddy
else
  write_override
  $DC up -d --build store rails
  front_reload
fi
BASE="${ONBOARD_URL:-https://$DOMAIN}"
printf '  waiting for %s/agents/healthz ' "$BASE"
health=""
for _ in $(seq 1 60); do
  health="$(curl -s $CURL_K --max-time 8 "$BASE/agents/healthz" || true)"
  case "$health" in *'"ok":true'*) break ;; esac
  printf '.'; sleep 5
done; echo
case "$health" in
  *'"ok":true'*) ok "seller node: $(printf '%s' "$health" | json_field offers) offers, $(printf '%s' "$health" | json_field countries) countries" ;;
  *'"ok":false'*) fail "the seller node answers but has no catalogue: the wholesaler's keys are wrong or unreadable (operator guide, section 14)" ;;
  *) fail "no answer at $BASE/agents/healthz: check DNS, ports 80 and 443, and '$DC logs caddy rails'" ;;
esac
PUB="$(printf '%s' "$health" | json_field provider_pubkey)"
[ -n "$PUB" ] || fail "the seller node did not give its provider key"

# ── 6. The federation ───────────────────────────────────────────────────────────────────────
if [ "$MODE" = node ]; then
  step "6. The federation node (aimarket node)"
  if [ -s data/hub/hub_signing_key ] && [ ! -s data/node/node_signing_key ]; then
    # Back from your own hub: the node takes the hub's key, so hubs that pinned this domain keep it.
    $SUDO cp -p data/hub/hub_signing_key data/node/node_signing_key
    ok "the hub's signing key moved into the node: this domain keeps its identity in the federation"
  fi
  demo_flag=""; [ "$(env_get DEMO_MODE)" = 1 ] && demo_flag="--demo"
  $DC exec -T rails node scripts/node-toml.mjs --name "$STORE_NAME" --url "https://$DOMAIN" \
    --product "$PRODUCT_ID" --upstream http://rails:9490 $demo_flag > node.toml.new
  grep -q 'provider_pubkey' node.toml.new || fail "node.toml has no provider_pubkey: is the seller node up?"
  mv node.toml.new node.toml
  env_set FEDERATION_UPSTREAM ""
  $DC --profile hub stop hub >/dev/null 2>&1 || true
  $DC --profile federation up -d --build node
  front_reload
  ok "node.toml written ($(grep -c '^\[\[capability\]\]' node.toml) capabilities) and the node started"
else
  step "6. Your own hub (aimarket hub)"
  if [ -s data/node/node_signing_key ] && [ ! -s data/hub/hub_signing_key ]; then
    # Hubs that already know this domain pinned the node's key: the hub keeps it, so they still do.
    $SUDO cp -p data/node/node_signing_key data/hub/hub_signing_key
    ok "the node's signing key moved into the hub: this domain keeps its identity in the federation"
  fi
  $DC --profile hub build hub
  if [ ! -s data/hub/aimarket.env ]; then
    out="$($DC --profile hub run --rm hub quickstart --name "$STORE_NAME" --url "https://$DOMAIN" 2>&1)" \
      || { printf '%s\n' "$out" | tail -20; fail "the hub's quickstart failed"; }
    # The test buyer key quickstart mints is a credential: kept off the screen and out of logs.
    printf '%s\n' "$out" | grep -E '✓|✗' | grep -v 'buyer key' | sed 's/^ */  /' || true
  fi
  out="$($DC --profile hub run --rm hub add esim.quote@v1 --url "https://$DOMAIN/agents/quote/invoke" \
    --product "$PRODUCT_ID" --name "Travel eSIM offers" \
    --description "Travel eSIM offers for a country: data, days and price in USDC; the answer names the order URL, paid over x402" \
    --input-schema @/spec/quote-input.schema.json --provider-pubkey "$PUB" 2>&1)" \
    || { printf '%s\n' "$out" | tail -20; fail "listing esim.quote@v1 on the hub failed"; }
  printf '%s\n' "$out" | grep -E '✓|✗' | head -1 | sed 's/^ */  /' || true
  env_set FEDERATION_UPSTREAM "hub:9083"
  $DC --profile federation stop node >/dev/null 2>&1 || true
  $DC --profile hub up -d hub
  front_reload
  ok "the hub lists esim.quote@v1 of $PRODUCT_ID, signed with your seller node's key"
fi

printf '  waiting for %s/.well-known/ai-market.json ' "$BASE"
for _ in $(seq 1 30); do url_ok "$BASE/.well-known/ai-market.json" && break; printf '.'; sleep 3; done; echo
url_ok "$BASE/.well-known/ai-market.json" || fail "nothing at $BASE/.well-known/ai-market.json: '$DC logs caddy $MODE'"
ok "the federation reads you at $BASE/.well-known/ai-market.json"

step "7. The admission check other hubs will run on you"
if [ "$MODE" = node ]; then
  # doctor speaks to hubs too: its admin-token and hub-name lines do not apply to a node.
  $DC --profile federation exec -T node aimarket doctor --url "https://$DOMAIN" \
    | grep -vE "AIMARKET_ADMIN_TOKEN is not set|the hub is called 'AIMarket Hub'" | sed 's/^/  /' || true
else
  $DC --profile hub exec -T hub aimarket doctor | sed 's/^/  /' || true
fi

# ── 8. Knock ────────────────────────────────────────────────────────────────────────────────
step "8. Join the federation"
if [ "$ANNOUNCE" = ask ]; then yes_no "Knock on $FEDERATION_HUB now?" && ANNOUNCE=yes || ANNOUNCE=no; fi
if [ "$ANNOUNCE" = yes ]; then
  if [ "$MODE" = node ]; then
    $DC --profile federation exec -T node aimarket node knock --config /node/node.toml --hub "$FEDERATION_HUB" | sed 's/^/  /' \
      || warn "the knock did not go through: see the lines above, then ./onboard.sh --announce"
  else
    answer="$(curl -s -X POST "$FEDERATION_HUB/ai-market/v2/federation/announce" -H 'Content-Type: application/json' \
      -d "{\"hub_url\": \"https://$DOMAIN\", \"hub_name\": \"$STORE_NAME\"}")"
    printf '  %s\n' "$answer" | cut -c1-300
  fi
  ok "knocked: the hub checks you in its sandbox and lists you when the check passes (usually minutes)"
else
  warn "not announced: run ./onboard.sh --announce $( [ "$MODE" = hub ] && echo --hub ) when you are ready"
fi

step "Done"
printf '  store for people     https://%s/\n' "$DOMAIN"
printf '  node for AI agents   https://%s/agents/  (quote, order over x402, status, refund)\n' "$DOMAIN"
[ "$MODE" = hub ] && printf '  your hub             https://%s/ai-market/v2/search · MCP https://%s/ai-market/mcp\n' "$DOMAIN" "$DOMAIN"
printf '  in the federation    %s/ai-market/v2/search?intent=esim\n' "$FEDERATION_HUB"
if [ "$(env_get DEMO_MODE)" = 1 ]; then
  printf '\n  %sDemo mode:%s live prices, nothing is sold. To sell: payment addresses and keys (operator guide,\n' "$Y" "$N"
  printf '  step 8), DEMO_MODE=0 in .env, then ./onboard.sh again and a test order (step 10).\n'
fi
