FROM node:22.14.0-alpine3.21 AS build

WORKDIR /app
COPY canvas-bff/package*.json ./canvas-bff/
RUN npm --prefix canvas-bff ci --no-audit --no-fund
COPY canvas-bff/ ./canvas-bff/
RUN npm --prefix canvas-bff run build

FROM node:22.14.0-alpine3.21

ENV NODE_ENV=production
ENV PORT=17372
WORKDIR /app/canvas-bff

COPY canvas-bff/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/canvas-bff/dist ./dist

USER node
EXPOSE 17372
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '17372') + '/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
