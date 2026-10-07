# Build context: repo root. Builds the React SPA, then serves it from nginx.
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace client

COPY client/ client/
RUN npm run build --workspace client

FROM nginx:1.27-alpine
COPY docker/nginx/security-headers.conf docker/nginx/locations.conf /etc/nginx/snippets/
# HSTS only makes sense over HTTPS: empty here, filled in by the production override.
RUN touch /etc/nginx/snippets/hsts.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
# Used in production: docker-compose.prod.yml mounts it into /etc/nginx/templates.
COPY docker/nginx/https.conf.template /etc/nginx/https.conf.template
COPY --from=build /app/client/dist /usr/share/nginx/html
