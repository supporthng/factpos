# Servidor FactPOS: API + base de datos local + apps web (Terminal y, en la nube, Administración)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/compartido/package.json packages/compartido/
COPY apps/servidor/package.json apps/servidor/
COPY apps/terminal/package.json apps/terminal/
COPY apps/admin/package.json apps/admin/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/compartido/package.json packages/compartido/
COPY --from=build /app/packages/compartido/dist packages/compartido/dist
COPY --from=build /app/apps/servidor/package.json apps/servidor/
COPY --from=build /app/apps/servidor/dist apps/servidor/dist
COPY --from=build /app/apps/terminal/package.json apps/terminal/
COPY --from=build /app/apps/terminal/dist apps/terminal/dist
COPY --from=build /app/apps/admin/package.json apps/admin/
COPY --from=build /app/apps/admin/dist apps/admin/dist
RUN npm ci --omit=dev -w @factpos/servidor -w @factpos/compartido
COPY db/migrations db/migrations
EXPOSE 3000
CMD ["node", "apps/servidor/dist/index.js"]
