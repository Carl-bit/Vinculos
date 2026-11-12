# Frontend Next.js del silo (portal publico SSR/SSG + backoffice CSR).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# API_URL: backend visto desde el contenedor (rewrites de /api y rutas /sesion).
ARG API_URL
ARG NEXT_PUBLIC_CENTRO_NOMBRE
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TEMA=moderno
ENV API_URL=$API_URL \
    NEXT_PUBLIC_CENTRO_NOMBRE=$NEXT_PUBLIC_CENTRO_NOMBRE \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_TEMA=$NEXT_PUBLIC_TEMA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# HOSTNAME=0.0.0.0: Docker pone HOSTNAME=<id del contenedor> y el server.js
# standalone escucha solo en la IP de ese nombre (una sola red). Con las redes
# proxy + silo, Traefik llega por la otra IP y recibe "connection refused" (502).
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
