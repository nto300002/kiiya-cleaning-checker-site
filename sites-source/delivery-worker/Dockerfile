FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs handler.mjs ./
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
