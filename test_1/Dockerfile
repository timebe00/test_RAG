FROM node:24.19.0-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install pm2@7.0.3 -g \
    && npm cache clean --force

EXPOSE 3000

CMD ["pm2-runtime", "start", "pm2.json"]
