# Build context: repo root (npm workspaces share one lockfile).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --omit=dev && npm cache clean --force

COPY server/ server/

WORKDIR /app/server
USER node
EXPOSE 4000

# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npx sequelize-cli db:migrate && node src/server.js"]
