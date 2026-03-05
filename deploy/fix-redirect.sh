#!/bin/bash
# 诊断和修复 /ontologyagent 自动跳转到根路径的问题

echo "=== 1. 检查当前 Nginx 配置 ==="
echo ""
echo "--- 所有 Nginx 配置文件 ---"
ls -la /etc/nginx/conf.d/
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "无 sites-enabled 目录"
echo ""

echo "--- 主配置文件 /etc/nginx/nginx.conf ---"
grep -n "include\|server\|location\|rewrite\|return" /etc/nginx/nginx.conf | head -20
echo ""

echo "--- ontologyagent 配置 ---"
if [ -f /etc/nginx/conf.d/ontologyagent.conf ]; then
    cat /etc/nginx/conf.d/ontologyagent.conf
else
    echo "未找到 /etc/nginx/conf.d/ontologyagent.conf"
fi
echo ""

echo "--- 检查其他可能导致跳转的配置 ---"
grep -r "location.*ontologyagent\|rewrite.*ontologyagent\|return.*ontologyagent" /etc/nginx/ 2>/dev/null
echo ""

echo "=== 2. 检查所有监听 80 端口的 server 块 ==="
grep -r "listen.*80" /etc/nginx/ -A 20 | grep -E "server_name|location|rewrite|return" | head -40
echo ""

echo "=== 3. 开始修复 ==="
echo "查找可能导致跳转的问题配置..."

# 检查是否有 default server 配置可能覆盖了我们的配置
DEFAULT_CONF=$(grep -l "listen.*80.*default_server" /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null | head -1)
if [ -n "$DEFAULT_CONF" ]; then
    echo "找到 default_server 配置: $DEFAULT_CONF"
    echo "这可能会影响 ontologyagent 的路由"
fi
echo ""

echo "=== 4. 应用正确的配置 ==="
echo "备份当前配置..."
cp -r /etc/nginx/conf.d /etc/nginx/conf.d.backup.$(date +%Y%m%d_%H%M%S)

echo "复制正确的 ontologyagent 配置..."
# 确保我们在项目目录
if [ -f deploy/nginx-ontologyagent.conf ]; then
    cp deploy/nginx-ontologyagent.conf /etc/nginx/conf.d/ontologyagent.conf
    echo "配置已复制"
else
    echo "错误：找不到 deploy/nginx-ontologyagent.conf，请确保在项目根目录运行此脚本"
    exit 1
fi

echo ""
echo "=== 5. 测试配置 ==="
nginx -t
if [ $? -eq 0 ]; then
    echo "配置测试通过"
    echo ""
    echo "=== 6. 重载 Nginx ==="
    systemctl reload nginx
    echo "Nginx 已重载"
    echo ""
    echo "✅ 修复完成！请访问 http://59.110.21.174/ontologyagent/ 测试"
else
    echo "❌ 配置测试失败，请检查错误信息"
    echo "已备份原配置到 /etc/nginx/conf.d.backup.*"
    exit 1
fi
