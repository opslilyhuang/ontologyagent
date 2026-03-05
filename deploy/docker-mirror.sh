#!/usr/bin/env bash
# 在服务器上配置 Docker 使用国内镜像加速，解决拉取 docker.io 超时
# 执行: sudo bash deploy/docker-mirror.sh 或 chmod +x deploy/docker-mirror.sh && sudo ./deploy/docker-mirror.sh
set -e
DAEMON_JSON=/etc/docker/daemon.json
MIRROR='https://docker.m.daocloud.io'

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 执行: sudo $0"
  exit 1
fi

if [ -f "$DAEMON_JSON" ]; then
  if grep -q registry-mirrors "$DAEMON_JSON"; then
    echo ">>> $DAEMON_JSON 中已存在 registry-mirrors，跳过"
    exit 0
  fi
  # 已有文件则追加 registry-mirrors（简单处理：用 sed 或 Python）
  echo ">>> 正在向 $DAEMON_JSON 添加 registry-mirrors..."
  python3 -c "
import json, sys
p = '$DAEMON_JSON'
with open(p) as f: d = json.load(f)
d.setdefault('registry-mirrors', []).append('$MIRROR')
d['registry-mirrors'] = list(dict.fromkeys(d['registry-mirrors']))
with open(p, 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
print('已添加')
" 2>/dev/null || {
    echo "无法解析 JSON，请手动在 $DAEMON_JSON 中加入: \"registry-mirrors\": [\"$MIRROR\"]"
    exit 1
  }
else
  echo ">>> 新建 $DAEMON_JSON"
  mkdir -p "$(dirname "$DAEMON_JSON")"
  echo "{\"registry-mirrors\": [\"$MIRROR\"]}" > "$DAEMON_JSON"
fi

echo ">>> 重启 Docker..."
systemctl restart docker
echo ">>> 完成。可重新执行: docker compose build frontend && docker compose up -d frontend"
