#!/bin/sh
# Publish the landing to esim.modelmarket.dev: ./deploy.sh [ssh-target]
#
# Static files to /var/www/esim-landing on the apex host, with a robots.txt and a sitemap of the
# landing and the guides (which nginx proxies to the example shop's container, see
# deploy/nginx/esim.modelmarket.dev.conf). GitHub Pages publishes the same folder (pages.yml).
set -eu
TARGET="${1:-factory-vps}"
KEY="${ESIM_SSH_KEY:-$HOME/.ssh/id_ed25519_factory}"
cd "$(dirname "$0")"
if [ -n "$(git status --porcelain -- .)" ]; then echo "esim-kit/docs/landing has uncommitted changes; commit first" >&2; exit 1; fi
SITE=https://esim.modelmarket.dev
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' "$SITE" > "$TMP/robots.txt"
{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  printf '<url><loc>%s/</loc></url>\n' "$SITE"
  for lang in "" ru/ es/ fr/ zh/; do
    for page in "" /rails /integrations /sdk /operator /agents /cases; do
      printf '<url><loc>%s/%skit%s</loc></url>\n' "$SITE" "$lang" "$page"
    done
  done
  printf '</urlset>\n'
} > "$TMP/sitemap.xml"
SSH="ssh -i $KEY -o IdentitiesOnly=yes"
$SSH "$TARGET" "mkdir -p /var/www/esim-landing" < /dev/null
rsync -az --delete -e "$SSH" index.html landing.js theme.js globe.js globe-data.js screenshots "$TMP/robots.txt" "$TMP/sitemap.xml" "$TARGET:/var/www/esim-landing/"
$SSH "$TARGET" "chmod -R a+rX /var/www/esim-landing" < /dev/null
echo "landing published to $SITE"
