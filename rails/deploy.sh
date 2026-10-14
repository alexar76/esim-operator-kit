#!/bin/sh
# Deploy the reference seller node to the apex host: ./deploy.sh [ssh-target]
#
# Ships the committed sources, builds there and swaps the container with a health check and
# automatic rollback (deploy/remote.sh). nginx serves it at /providers/esim/ (port 9493).
# Secrets stay on the host: /opt/esim-secrets (the wholesale keys) and the CDP key the gateway uses.
set -eu
TARGET="${1:-factory-vps}"
KEY="${ESIM_SSH_KEY:-$HOME/.ssh/id_ed25519_factory}"
PAY_TO="${ESIM_PAY_TO:-0x1218ff36C5d2e3B6A565CdB1A8B1AcCFc606Ad0a}"   # the operator's wallet: public
# Our own node is the reference DEMO (quotes live, sells nothing); ESIM_NODE_DEMO=0 makes a node that sells.
DEMO="${ESIM_NODE_DEMO:-1}"
cd "$(dirname "$0")"
TAG="prod-$(date -u +%Y%m%d)-$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain -- . )" ]; then echo "esim-rails has uncommitted changes; commit first" >&2; exit 1; fi
rsync -az --delete -e "ssh -i $KEY -o IdentitiesOnly=yes" \
  Dockerfile package.json package-lock.json src scripts deploy/remote.sh "$TARGET:/opt/esim-rails/"
ssh -i "$KEY" -o IdentitiesOnly=yes "$TARGET" "sh /opt/esim-rails/remote.sh $TAG $PAY_TO $DEMO" < /dev/null
