FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY cloudfunctions/menuService/lib ./cloudfunctions/menuService/lib
RUN mkdir -p server/data && chown -R node:node server/data
USER node
ENV HOST=0.0.0.0 PORT=3000 MENU_DATA_DIR=/app/server/data
EXPOSE 3000
CMD ["node", "server/index.js"]
