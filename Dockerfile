# Stratus Weather Station - Production Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/shared ./shared

# Create directories for data persistence
RUN mkdir -p /app/data /app/logs

# Non-root user for security
RUN addgroup -g 1001 -S stratus && \
    adduser -S stratus -u 1001 -G stratus && \
    chown -R stratus:stratus /app

USER stratus

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the application
CMD ["node", "dist/server/index.js"]
