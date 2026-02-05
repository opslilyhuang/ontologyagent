FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json .
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Serve 静态产物 ──
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
