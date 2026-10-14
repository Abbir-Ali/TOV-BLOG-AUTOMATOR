FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# secrets/ and .env are injected at runtime via Railway environment variables
# NEVER bake secrets into the image
EXPOSE 3000
CMD ["node", "dist/index.js"]
