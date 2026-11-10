FROM node:22-slim
WORKDIR /app
COPY voice-server/package.json voice-server/package-lock.json ./
RUN npm ci --omit=dev
COPY voice-server/ ./
COPY assets/voice/voices ./assets/voice/voices
COPY assets/vendor/headtts/dictionaries ./assets/vendor/headtts/dictionaries
ENV NODE_ENV=production
ENV HEADTTS_ASSET_ROOT=/app
ENV PORT=8883
ENV HEADTTS_INTERNAL_PORT=8892
EXPOSE 8883
CMD ["node", "server.mjs"]
