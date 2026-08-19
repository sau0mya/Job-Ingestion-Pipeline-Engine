# Stage 1: Builder
FROM node:20 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (will compile better-sqlite3 from source if prebuilt binary is missing for the arch)
RUN npm ci

# Stage 2: Runner
FROM node:20-slim

WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/jobs.db

# Create the data directory for SQLite database storage and set proper owner permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy production artifacts from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Use non-root node user for container execution (security best practice)
USER node

# Expose standard application port
EXPOSE 3000

# Start Express server and the scraper daemon
CMD ["node", "src/server.js"]
