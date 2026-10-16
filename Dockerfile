FROM node:24-alpine
WORKDIR /app

ARG SOURCE_COMMIT=unknown
ARG GIT_REF=unknown
ENV SOURCE_COMMIT=$SOURCE_COMMIT GIT_REF=$GIT_REF NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
