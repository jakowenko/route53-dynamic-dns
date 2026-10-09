FROM node:22-alpine

WORKDIR /app

COPY ./src/package.json ./src/package-lock.json ./

RUN npm ci --omit=dev

COPY ./src/index.js ./

USER node

CMD [ "node", "index.js" ]
