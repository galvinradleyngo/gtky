FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV FIRESTORE_ENABLED=1

# Cloud Run sets PORT itself; server.js already reads process.env.PORT.
CMD ["node", "server.js"]
