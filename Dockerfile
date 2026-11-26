FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY data ./data
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV MODELCANON_OFFLINE_FALLBACK=1

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data

RUN chown -R node:node /app
USER node

ENTRYPOINT ["node", "dist/cli.js"]
