#!/bin/bash

echo "🔧 Docker Desktop 修复工具"
echo "================================"
echo ""

# Step 1: 检查 Docker Desktop 状态
echo "📋 Step 1: 检查当前状态..."
if pgrep -q "Docker Desktop"; then
    echo "   ✅ Docker Desktop UI 正在运行"
else
    echo "   ❌ Docker Desktop UI 未运行"
fi

if pgrep -q "com.docker.backend"; then
    echo "   ✅ Docker Backend 正在运行"
    echo ""
    echo "Docker 看起来正常，尝试连接..."
    docker ps > /dev/null 2>&1 && echo "   ✅ Docker 工作正常！" && exit 0
else
    echo "   ❌ Docker Backend 未运行（这是问题所在！）"
fi

echo ""

# Step 2: 完全停止 Docker
echo "📋 Step 2: 完全停止 Docker Desktop..."
osascript -e 'quit app "Docker"' 2>/dev/null || true
sleep 3

# 强制杀死所有 Docker 进程
echo "   → 清理残留进程..."
pkill -9 -f "Docker Desktop" 2>/dev/null || true
pkill -9 -f "com.docker" 2>/dev/null || true
sleep 2

# Step 3: 清理可能的锁文件
echo "📋 Step 3: 清理锁文件和状态..."
rm -f ~/Library/Group\ Containers/group.com.docker/docker.sock.lock 2>/dev/null || true
rm -f ~/.docker/run/*.lock 2>/dev/null || true
echo "   ✅ 清理完成"
echo ""

# Step 4: 重启 Docker Desktop
echo "📋 Step 4: 重新启动 Docker Desktop..."
open -a Docker

echo "   等待 Docker Desktop 启动..."
sleep 10

# 等待最多 60 秒让 Docker 完全启动
echo "   检查 Docker daemon 是否准备就绪..."
COUNTER=0
MAX_WAIT=60

while [ $COUNTER -lt $MAX_WAIT ]; do
    if docker info > /dev/null 2>&1; then
        echo "   ✅ Docker daemon 已就绪！"
        break
    fi
    
    if pgrep -q "com.docker.backend"; then
        echo "   ⏳ Backend 进程已启动，等待就绪... ($COUNTER/$MAX_WAIT)"
    else
        echo "   ⏳ 等待 Backend 进程启动... ($COUNTER/$MAX_WAIT)"
    fi
    
    sleep 2
    COUNTER=$((COUNTER + 2))
done

echo ""

# Step 5: 验证
echo "📋 Step 5: 验证 Docker 状态..."
if docker info > /dev/null 2>&1; then
    echo "   ✅ Docker 工作正常！"
    echo ""
    docker version
    echo ""
    echo "================================"
    echo "✨ 修复成功！现在可以启动开发环境了："
    echo "   pnpm run start-deps:minimal"
    echo "================================"
    exit 0
else
    echo "   ❌ Docker 仍然无法连接"
    echo ""
    echo "================================"
    echo "⚠️  自动修复失败，请尝试："
    echo ""
    echo "1. 手动重启 Docker Desktop："
    echo "   - 点击菜单栏的 Docker 图标"
    echo "   - 选择 'Restart'"
    echo ""
    echo "2. 如果还不行，完全卸载重装："
    echo "   - 在 Docker Desktop 中选择 'Troubleshoot' > 'Clean / Purge data'"
    echo "   - 或者完全卸载后重新安装"
    echo ""
    echo "3. 检查系统日志查看错误："
    echo "   tail -f ~/Library/Containers/com.docker.docker/Data/log/vm/dockerd.log"
    echo "================================"
    exit 1
fi

