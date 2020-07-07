FROM node:12

WORKDIR /

COPY ./src/index.js ./src/package.json ./

RUN npm install

COPY . .

CMD [ "node", "index.js" ]