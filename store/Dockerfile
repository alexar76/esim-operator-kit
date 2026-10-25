# Node security baseline: 22.23.4 (2026-10-21 security release).
# Built from a directory holding store/, rails/src, README.md and docs/ (deploy.sh lays it out; in the kit, esim-kit/ itself):
#   docker build -f store/Dockerfile .
FROM node:22.23.4-alpine
WORKDIR /app/store
ENV NODE_ENV=production
COPY store/package.json store/package-lock.json ./
COPY store/vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY rails/src /app/rails/src
COPY store/src ./src
COPY store/public ./public
# The kit's guides, served at /kit in demo mode.
COPY README*.md /app/
COPY docs /app/docs
USER node
ENV HOST=0.0.0.0 PORT=9495
EXPOSE 9495
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:9495/robots.txt >/dev/null || exit 1
CMD ["node", "src/server.js"]
