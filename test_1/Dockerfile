FROM node:24.19.0-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && if ! command -v pm2 > /dev/null 2>&1; then npm install pm2@7.0.3 -g; fi \
    && npm cache clean --force

COPY . .

EXPOSE 3000

CMD ["pm2-runtime", "start", "pm2.json"]
