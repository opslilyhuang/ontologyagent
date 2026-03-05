#!/usr/bin/env bash
# 在阿里云服务器上、项目目录下执行此脚本，完成子路径不跳转根路径的配置
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ">>> 复制宿主机 Nginx 配置..."
sudo cp "$SCRIPT_DIR/nginx-ontologyagent.conf" /etc/nginx/conf.d/ontologyagent.conf

echo ">>> 检查 Nginx 配置..."
sudo nginx -t

echo ">>> 重载 Nginx..."
sudo systemctl reload nginx

echo ">>> 重建并启动前端容器（使容器内 nginx.conf 生效）..."
cd "$PROJECT_DIR"
# 若无 .env 则从 .env.example 复制，避免 docker compose 报错
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    已从 .env.example 创建 .env，可按需编辑后重启服务"
fi
docker compose build frontend
docker compose up -d frontend

echo ">>> 完成。请用 http://59.110.21.174/ontologyagent 或 /ontologyagent/ 访问，不应再跳转到根路径。"
