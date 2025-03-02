FROM node:16

RUN apt-get update && apt-get install -y \
    ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

RUN mkdir -p temp/media temp/audio temp/output

EXPOSE 3000

CMD ["node", "server.js"]