FROM node:20-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

# Hugging Face Spaces routes traffic to port 7860
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

CMD ["node", "src/index.js"]
