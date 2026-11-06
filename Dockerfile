FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.mjs ./
COPY src ./src
COPY public ./public
# Self-hosting uses only the Vite client; no Sites account/hosting metadata.
RUN npx vite build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DB_PATH=/app/data/wenxing.sqlite BASE_PATH=/wenxing
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist/client ./dist/client
COPY server ./server
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+(process.env.BASE_PATH||'/wenxing')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
