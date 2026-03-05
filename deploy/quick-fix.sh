#!/bin/bash
# 一键修复 /ontologyagent 自动跳转问题

set -e

echo "🔍 诊断问题..."
echo ""

# 检查项目目录
if [ ! -f "deploy/nginx-full.conf" ]; then
    echo "❌ 请在项目根目录（包含 deploy/ 文件夹的目录）运行此脚本"
    echo "   例如: cd /root/ontology-agent && bash deploy/quick-fix.sh"
    exit 1
fi

echo "📋 当前 Nginx 配置文件："
ls -la /etc/nginx/conf.d/*.conf 2>/dev/null || echo "  conf.d 目录为空"
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "  无 sites-enabled 目录"
echo ""

echo "🔎 查找可能导致跳转的配置..."
REDIRECTS=$(grep -r "rewrite.*/" /etc/nginx/conf.d/ /etc/nginx/sites-enabled/ 2>/dev/null | grep -v ".bak" | head -5)
if [ -n "$REDIRECTS" ]; then
    echo "⚠️  发现以下 rewrite 规则："
    echo "$REDIRECTS"
    echo ""
fi

echo "💾 备份现有配置..."
BACKUP_DIR="/etc/nginx/conf.d.backup.$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r /etc/nginx/conf.d/* "$BACKUP_DIR/" 2>/dev/null || true
echo "  备份保存到: $BACKUP_DIR"
echo ""

echo "📝 删除可能冲突的配置..."
# 删除旧的 ontologyagent 配置（如果存在）
rm -f /etc/nginx/conf.d/ontologyagent.conf
rm -f /etc/nginx/conf.d/default.conf
echo "  已删除旧配置"
echo ""

echo "✅ 应用新的正确配置..."
cp deploy/nginx-full.conf /etc/nginx/conf.d/ontologyagent.conf
chmod 644 /etc/nginx/conf.d/ontologyagent.conf
echo "  新配置已复制"
echo ""

echo "🧪 测试 Nginx 配置..."
if nginx -t; then
    echo "  ✅ 配置测试通过"
else
    echo "  ❌ 配置测试失败！恢复备份..."
    rm -f /etc/nginx/conf.d/ontologyagent.conf
    cp -r "$BACKUP_DIR"/* /etc/nginx/conf.d/
    nginx -t
    exit 1
fi
echo ""

echo "🔄 重载 Nginx..."
systemctl reload nginx
echo "  ✅ Nginx 已重载"
echo ""

echo "📊 检查服务状态..."
systemctl status nginx --no-pager -l | head -10
echo ""

echo "🎉 修复完成！"
echo ""
echo "📌 测试访问："
echo "   http://59.110.21.174/ontologyagent/"
echo ""
echo "💡 如果还有问题，请检查："
echo "   1. Docker 容器是否正在运行: docker ps"
echo "   2. 前端容器端口映射: docker ps | grep frontend"
echo "   3. 后端容器端口映射: docker ps | grep backend"
echo "   4. Nginx 访问日志: tail -f /var/log/nginx/access.log"
echo "   5. Nginx 错误日志: tail -f /var/log/nginx/error.log"
