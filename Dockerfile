# --- Build stage: install deps + build frontend ---
FROM node:20-alpine AS build
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install frontend dependencies and build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# --- Production stage: server + built frontend ---
FROM node:20-alpine
WORKDIR /app

# Install fpcalc (Chromaprint) for audio fingerprinting and ffmpeg for audio conversion
RUN apk add --no-cache chromaprint ffmpeg

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install server dependencies only
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN cd server && pnpm install --frozen-lockfile --prod

# Copy server code
COPY server/ ./server/

# Copy built frontend from build stage
COPY --from=build /app/dist ./dist

ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "index.js"]
