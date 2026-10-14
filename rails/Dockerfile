FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER node
ENV HOST=0.0.0.0 PORT=9490
EXPOSE 9490
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:9490/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
