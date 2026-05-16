export function generateExpressDockerfile(port: number): string {
  return `FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript if tsconfig present
RUN if [ -f "tsconfig.json" ]; then \\
      npm install -D typescript && npx tsc --outDir dist || true; \\
    fi

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE ${port}

CMD ["sh", "-c", "[ -d dist ] && node dist/index.js || node index.js || node src/index.js"]
`;
}
