FROM node:20-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends tor python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages curl_cffi cloudscraper "requests[socks]" pysocks \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY server/src ./src
COPY server/start.sh ./start.sh
RUN chmod +x ./start.sh

ENV PORT=7860
ENV NODE_ENV=production
ENV ENABLE_TOR=1
ENV STEALTH_URL=http://127.0.0.1:8191
EXPOSE 7860

CMD ["./start.sh"]
