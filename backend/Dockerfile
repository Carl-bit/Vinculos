# Backend NestJS del silo.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3001
# La API solo arranca. Migraciones + contraseña de app_user las corre el
# servicio `migrate` (misma imagen, otro command) antes que la API; ver
# infra/docker-compose.yml. Por eso `prisma` (CLI) va en dependencies.
CMD ["node", "dist/main"]
