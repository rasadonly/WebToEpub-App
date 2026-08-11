FROM node:20-slim

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server/src ./src

ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

CMD ["node", "src/index.js"]
