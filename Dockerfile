# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY vendor ./vendor
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production ROM_DIR=/data/roms
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vendor ./vendor
COPY package.json LICENSE THIRD_PARTY_NOTICES.md README.md ./
RUN mkdir -p /data/roms && chown -R node:node /data
USER node
EXPOSE 3001
ENTRYPOINT ["node", "dist/index.js"]
