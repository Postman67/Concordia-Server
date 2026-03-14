# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Only install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Media storage directory — on Railway, attach a Volume with mount path /data/media
# On self-hosted Docker, this directory is bind-mounted or managed via docker run -v
RUN mkdir -p /data/media

EXPOSE 3000

CMD ["node", "dist/index.js"]
