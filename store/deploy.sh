#!/bin/sh
# Deploy the reference storefront to the apex host: ./deploy.sh [ssh-target]
#
# Ships the committed store and the rails code it runs on, builds there and swaps the
# container with a health check and rollback (deploy/remote.sh). Our own deployment is the DEMO
# (ESIM_STORE_DEMO=1, the default): live prices, a banner, payments off — a storefront for
# integrators to try before they run their own. nginx serves it as esim-shop.modelmarket.dev (port 9497),
# and its /kit guides under the landing's host, esim.modelmarket.dev.
set -eu
TARGET="${1:-factory-vps}"
KEY="${ESIM_SSH_KEY:-$HOME/.ssh/id_ed25519_factory}"
DEMO="${ESIM_STORE_DEMO:-1}"
cd "$(dirname "$0")"
TAG="prod-$(date -u +%Y%m%d)-$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain -- . ../rails/src ../README*.md ../docs)" ]; then echo "esim-kit has uncommitted changes; commit first" >&2; exit 1; fi
SSH="ssh -i $KEY -o IdentitiesOnly=yes"
$SSH "$TARGET" "mkdir -p /opt/travel-esim/store /opt/travel-esim/rails" < /dev/null
rsync -az --delete -e "$SSH" Dockerfile package.json package-lock.json src public deploy/remote.sh "$TARGET:/opt/travel-esim/store/"
rsync -az --delete -e "$SSH" ../rails/src "$TARGET:/opt/travel-esim/rails/"
rsync -az --delete -e "$SSH" ../README*.md ../docs "$TARGET:/opt/travel-esim/"
# The layout before the kit had its own folder: travel-esim/ and esim-rails/ side by side.
$SSH "$TARGET" "rm -rf /opt/travel-esim/travel-esim /opt/travel-esim/esim-rails; sh /opt/travel-esim/store/remote.sh $TAG $DEMO" < /dev/null
