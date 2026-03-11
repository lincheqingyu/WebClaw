# WebClaw 部署指南

## 环境要求

- Linux（Ubuntu 20.04+ / Debian 11+）
- Node.js >= 20
- pnpm >= 8
- nginx（可选，用于反代和静态文件服务）

## 目录结构

部署后文件分布：

```
~/.webclaw/workspace/          # 项目根目录
├── frontend/dist/             # 前端静态文件
├── backend/dist/              # 后端编译产物
├── backend/.env               # 后端环境变量
├── backend/.sessions-v2/      # 会话持久化
└── shared/                    # 共享类型包

~/.config/systemd/user/
└── webclaw-backend.service    # systemd 用户服务
```

## 快速部署

### 1. 上传代码到服务器

```bash
# 方式一：scp
scp -r . user@server:~/webclaw-src/

# 方式二：git clone
git clone <your-repo-url> ~/webclaw-src
```

### 2. 安装 Node.js 和 pnpm

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# pnpm
npm install -g pnpm

# 验证
node -v   # >= 20
pnpm -v
```

### 3. 首次部署

```bash
cd ~/webclaw-src
bash deploy/deploy.sh
```

脚本会自动：
1. 复制代码到 `~/.webclaw/workspace/`
2. 安装依赖并构建前端 + 后端
3. 注册 systemd 用户服务
4. 启动后端

首次运行会提示编辑 `.env`，按提示操作：

```bash
vim ~/.webclaw/workspace/backend/.env
```

填入必要配置后重新运行：

```bash
bash deploy/deploy.sh
```

### 4. 配置 nginx（推荐）

```bash
sudo apt install -y nginx
sudo cp deploy/webclaw.nginx.conf /etc/nginx/sites-available/webclaw
sudo ln -sf /etc/nginx/sites-available/webclaw /etc/nginx/sites-enabled/webclaw
sudo rm -f /etc/nginx/sites-enabled/default
```

编辑 `server_name` 为你的域名或 IP：

```bash
sudo vim /etc/nginx/sites-available/webclaw
```

启用：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 环境变量

`backend/.env` 必填项：

```bash
PORT=5000
NODE_ENV=production
LOG_LEVEL=info

# LLM 配置
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-plus
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=8192
LLM_TIMEOUT=120000
```

可选项：

```bash
# 达梦数据库
DM_CONNECT_STRING=dm://user:pass@host:port?schema=xxx
```

## 日常运维

### 服务管理

```bash
# 查看状态（类似 openclaw-gateway）
systemctl --user status webclaw-backend

# 重启
systemctl --user restart webclaw-backend

# 停止
systemctl --user stop webclaw-backend

# 查看实时日志
journalctl --user -u webclaw-backend -f

# 查看最近 100 行日志
journalctl --user -u webclaw-backend -n 100 --no-pager
```

### 更新部署

代码有变更时：

```bash
# 方式一：从源码目录更新
cd ~/webclaw-src
git pull
bash deploy/deploy.sh update

# 方式二：直接在 workspace 里更新
cd ~/.webclaw/workspace
git pull
bash deploy/deploy.sh update
```

`update` 会自动重新构建并重启后端，前端静态文件即时生效。

### 卸载

```bash
bash deploy/deploy.sh uninstall
# 服务已移除，代码保留在 ~/.webclaw/workspace/
# 如需完全清除：rm -rf ~/.webclaw
```

## 架构

```
客户端浏览器
    │
    ▼
nginx (:80)
    ├── /            → 前端静态文件 (~/.webclaw/workspace/frontend/dist/)
    ├── /api/*       → 反代后端 (127.0.0.1:5000)
    └── /ws          → WebSocket 反代 (127.0.0.1:5000)
                            │
                            ▼
                    webclaw-backend (systemd --user)
                        │
                        ├── Agent Runner → LLM API
                        ├── 工具系统 (bash, read_file, skill...)
                        └── 会话管理 (.sessions-v2/)
```

## 故障排查

### 后端启动失败

```bash
# 查看详细错误
journalctl --user -u webclaw-backend -n 50 --no-pager

# 常见原因
# 1. .env 未配置 → vim ~/.webclaw/workspace/backend/.env
# 2. 端口占用 → lsof -i :5000
# 3. 构建产物缺失 → cd ~/.webclaw/workspace && pnpm build
```

### 前端访问 404

```bash
# 确认构建产物存在
ls ~/.webclaw/workspace/frontend/dist/index.html

# 确认 nginx 配置正确
sudo nginx -t
sudo systemctl status nginx
```

### 服务登出后停止

```bash
# 开启 linger，用户未登录时服务仍运行
loginctl enable-linger $(whoami)
```

### WebSocket 连接失败

检查 nginx 的 `/ws` 路径是否与后端实际 WS 路径一致。查看后端日志确认 WS 监听状态。

## deploy.sh 命令参考

| 命令 | 说明 |
|------|------|
| `bash deploy.sh` | 首次安装 |
| `bash deploy.sh update` | 更新代码并重启 |
| `bash deploy.sh status` | 查看服务状态 |
| `bash deploy.sh logs` | 查看实时日志 |
| `bash deploy.sh uninstall` | 卸载服务 |
