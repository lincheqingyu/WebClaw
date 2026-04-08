#!/bin/bash
set -e

# ============================
# Lecquy 部署脚本（user-level systemd）
#
# 用法:
#   bash deploy.sh              首次安装
#   bash deploy.sh update       更新代码并重启
#   bash deploy.sh status       查看服务状态
#   bash deploy.sh logs         查看实时日志
#   bash deploy.sh uninstall    卸载服务
# ============================

VERSION="v$(date +%Y.%-m.%-d)"
WORKSPACE="$HOME/.lecquy/workspace"
SERVICE_NAME="lecquy-backend"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"

info() { echo -e "\033[32m[lecquy]\033[0m $1"; }
warn() { echo -e "\033[33m[lecquy]\033[0m $1"; }
err()  { echo -e "\033[31m[lecquy]\033[0m $1"; exit 1; }

# ============================
# 环境检查
# ============================
check_deps() {
    command -v node >/dev/null || err "未安装 Node.js (需 >= 20)"
    command -v pnpm >/dev/null || err "未安装 pnpm，运行: npm install -g pnpm"

    NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    [ "$NODE_VER" -ge 20 ] || err "Node.js 版本需 >= 20，当前: $(node -v)"
}

# ============================
# 构建项目
# ============================
build() {
    info "构建项目..."
    cd "$WORKSPACE"

    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm -F @lecquy/shared build
    pnpm -F @lecquy/frontend build
    pnpm -F @lecquy/backend build

    info "构建完成"
    info "  前端: $WORKSPACE/frontend/dist/"
    info "  后端: $WORKSPACE/backend/dist/"
}

# ============================
# 安装 systemd 用户服务
# ============================
install_service() {
    info "安装 systemd 用户服务..."
    mkdir -p "$SERVICE_DIR"

    # 生成 service 文件（替换版本号）
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Lecquy Backend ($VERSION)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORKSPACE/backend
EnvironmentFile=$WORKSPACE/backend/.env
ExecStart=$(command -v node) $WORKSPACE/backend/dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
MemoryMax=1G
TasksMax=50

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME"
    info "服务已安装: $SERVICE_FILE"
}

# ============================
# 首次部署
# ============================
do_install() {
    check_deps

    # 创建 workspace
    mkdir -p "$WORKSPACE"

    if [ ! -f "$WORKSPACE/package.json" ]; then
        # 如果从项目目录运行，复制代码过去
        SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
        if [ -f "$SCRIPT_DIR/package.json" ]; then
            info "复制项目到 $WORKSPACE/ ..."
            rsync -a --exclude='node_modules' --exclude='dist' --exclude='.git' \
                  --exclude='.idea' --exclude='.claude' --exclude='.agents' \
                  --exclude='.codex' \
                  "$SCRIPT_DIR/" "$WORKSPACE/"
        else
            err "请先将项目代码放到 $WORKSPACE/"
        fi
    fi

    # 检查 .env
    if [ ! -f "$WORKSPACE/backend/.env" ]; then
        cp "$WORKSPACE/backend/.env.example" "$WORKSPACE/backend/.env"
        warn "已创建 $WORKSPACE/backend/.env"
        warn "请编辑填入实际配置: vim $WORKSPACE/backend/.env"
        warn "配置好后重新运行: bash deploy.sh"
        exit 0
    fi

    # 确保 session 目录和索引文件存在
    mkdir -p "$WORKSPACE/backend/.sessions-v2"
    [ -s "$WORKSPACE/backend/.sessions-v2/sessions.json" ] || echo '{}' > "$WORKSPACE/backend/.sessions-v2/sessions.json"

    build
    install_service

    # 确保 user lingering 开启（用户未登录时服务仍运行）
    loginctl enable-linger "$(whoami)" 2>/dev/null || warn "无法开启 linger，服务可能在用户登出后停止"

    systemctl --user start "$SERVICE_NAME"
    info "部署完成！"
    echo ""
    do_status
    echo ""
    info "常用命令:"
    info "  systemctl --user status $SERVICE_NAME    查看状态"
    info "  systemctl --user restart $SERVICE_NAME   重启服务"
    info "  journalctl --user -u $SERVICE_NAME -f    查看实时日志"
}

# ============================
# 更新部署
# ============================
do_update() {
    check_deps
    [ -f "$WORKSPACE/package.json" ] || err "项目未安装，请先运行: bash deploy.sh"

    # 如果从项目目录运行，同步代码
    SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
    if [ -f "$SCRIPT_DIR/package.json" ] && [ "$SCRIPT_DIR" != "$WORKSPACE" ]; then
        info "同步代码到 $WORKSPACE/ ..."
        rsync -a --exclude='node_modules' --exclude='dist' --exclude='.git' \
              --exclude='.idea' --exclude='.claude' --exclude='.agents' \
              --exclude='.codex' --exclude='backend/.env' \
              --exclude='backend/.sessions-v2' \
              "$SCRIPT_DIR/" "$WORKSPACE/"
    fi

    build
    install_service
    systemctl --user restart "$SERVICE_NAME"
    info "更新完成！"
    echo ""
    do_status
}

# ============================
# 状态 / 日志 / 卸载
# ============================
do_status() {
    systemctl --user status "$SERVICE_NAME" --no-pager
}

do_logs() {
    journalctl --user -u "$SERVICE_NAME" -f --no-hostname
}

do_uninstall() {
    info "卸载服务..."
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload
    info "服务已卸载（代码保留在 $WORKSPACE/）"
}

# ============================
# 入口
# ============================
case "${1:-}" in
    update)    do_update ;;
    status)    do_status ;;
    logs)      do_logs ;;
    uninstall) do_uninstall ;;
    *)         do_install ;;
esac
