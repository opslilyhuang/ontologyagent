#!/bin/bash
# 修复线上 ontologyagent 跳转问题
# 使用方法：在服务器上运行此脚本

set -e

echo "🔧 开始修复 ontologyagent 跳转问题..."

# 1. 备份现有配置
BACKUP_DIR="/etc/nginx/conf.d.backup.$(date +%Y%m%d_%H%M%S)"
echo "📦 备份现有 Nginx 配置到: $BACKUP_DIR"
sudo mkdir -p "$BACKUP_DIR"
sudo cp /etc/nginx/conf.d/ontologyagent.conf "$BACKUP_DIR/" 2>/dev/null || echo "  没有找到旧配置文件"

# 2. 复制新配置
echo "📝 应用新的 Nginx 配置..."
sudo cp /root/ontologyagent/deploy/nginx-server.conf /etc/nginx/conf.d/ontologyagent.conf

# 3. 测试配置
echo "🧪 测试 Nginx 配置..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "  ✅ 配置测试通过"

    # 4. 重载 Nginx
    echo "🔄 重载 Nginx..."
    sudo systemctl reload nginx

    echo ""
    echo "✅ 修复完成！"
    echo ""
    echo "📌 现在访问: http://59.110.21.174/ontologyagent/"
    echo ""
    echo "🔍 如果还有问题，请检查："
    echo "   1. Docker 容器状态: docker ps"
    echo "   2. 前端容器日志: docker logs ontologyagent-frontend-1"
    echo "   3. 后端容器日志: docker logs ontologyagent-backend-1"
    echo "   4. Nginx 访问日志: tail -f /var/log/nginx/access.log"
    echo "   5. Nginx 错误日志: tail -f /var/log/nginx/error.log"
else
    echo "  ❌ Nginx 配置测试失败，请检查配置文件"
    echo "  配置文件位置: /etc/nginx/conf.d/ontologyagent.conf"
    exit 1
fi
