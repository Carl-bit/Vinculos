# Frontend Next.js del silo (portal publico SSR/SSG + backoffice CSR).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# API_URL: backend visto desde el contenedor (rewrites de /api y rutas /sesion).
# Igual en todos los silos (alias api-silo). Nada del centro se hornea aqui
# (R11): nombre, tema y dominio llegan en runtime (CENTRO_NOMBRE, TEMA, SITE_URL).
ARG API_URL
ENV API_URL=$API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# HOSTNAME=0.0.0.0: Docker pone HOSTNAME=<id del contenedor> y el server.js
# standalone escucha solo en la IP de ese nombre (una sola red). Con las redes
# borde + silo, Traefik llega por la otra IP y recibe "connection refused" (502).
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
