FROM node:16-alpine

# install build deps
RUN apk add python3 py3-pip build-base

# install deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# install pytchat
RUN python3 -m pip install pytchat
RUN mkdir logs
COPY chat_dl.py ./

# build ts files
COPY ./src ./src
COPY tsconfig.json ./
RUN npm run tsc

CMD ["node", "./build/index.js"]
