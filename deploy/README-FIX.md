# 修复 /ontologyagent 自动跳转问题

## 问题描述
访问 `http://59.110.21.174/ontologyagent` 时会自动跳转到根地址 `http://59.110.21.174`

## 原因分析
服务器上的 Nginx 配置可能存在以下问题之一：
1. 有其他配置文件（如 default.conf）的规则覆盖了 ontologyagent 的配置
2. 存在 rewrite 规则导致重定向
3. proxy_redirect 没有正确设置

## 快速修复（推荐）

在服务器上执行以下命令：

```bash
# 1. SSH 登录服务器
ssh root@59.110.21.174

# 2. 进入项目目录
cd /root/ontology-agent   # 或你的实际项目路径

# 3. 拉取最新代码（包含修复脚本）
git pull

# 4. 运行一键修复脚本
bash deploy/quick-fix.sh
```

脚本会自动：
- 备份现有配置
- 删除可能冲突的配置文件
- 应用正确的 Nginx 配置
- 测试并重载 Nginx

## 手动修复

如果自动脚本不工作，可以手动操作：

```bash
# 1. 备份现有配置
sudo cp -r /etc/nginx/conf.d /etc/nginx/conf.d.backup

# 2. 删除可能冲突的配置
sudo rm -f /etc/nginx/conf.d/default.conf
sudo rm -f /etc/nginx/conf.d/ontologyagent.conf

# 3. 复制新配置
sudo cp deploy/nginx-full.conf /etc/nginx/conf.d/ontologyagent.conf

# 4. 测试配置
sudo nginx -t

# 5. 重载 Nginx
sudo systemctl reload nginx
```

## 验证修复

修复后，访问以下地址验证：

- ✅ `http://59.110.21.174/ontologyagent/` - 应该显示前端页面
- ✅ `http://59.110.21.174/ontologyagent` - 应该 301 重定向到上面的地址
- ✅ `http://59.110.21.174/` - 应该显示简单提示页面（不是 ontologyagent）

## 调试工具

如果问题依然存在：

```bash
# 查看 Nginx 配置
cat /etc/nginx/conf.d/ontologyagent.conf

# 查看所有 Nginx 配置文件
ls -la /etc/nginx/conf.d/

# 检查 Docker 容器状态
docker ps

# 查看 Nginx 访问日志
tail -f /var/log/nginx/access.log

# 查看 Nginx 错误日志
tail -f /var/log/nginx/error.log

# 测试前端容器是否可访问
curl http://127.0.0.1:3000/ontologyagent/

# 测试后端健康检查
curl http://127.0.0.1:8000/health
```

## 诊断脚本

使用诊断脚本查看详细信息：

```bash
bash deploy/fix-redirect.sh
```

此脚本会显示所有 Nginx 配置文件和可能导致跳转的规则。
