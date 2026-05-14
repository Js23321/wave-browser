FROM node:20-slim
ENV NODE_ENV=production
EXPOSE 8080/tcp
LABEL maintainer="Mercury Workshop"
RUN npm install -g pnpm
WORKDIR /app
COPY ["package.json", "pnpm-lock.yaml", "./"]
RUN apt-get update && apt-get install -y python3 make g++ && \
    pnpm install --prod --frozen-lockfile && \
    apt-get purge -y make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
ENTRYPOINT [ "node" ]
CMD ["src/index.js"]
