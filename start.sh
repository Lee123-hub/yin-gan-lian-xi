#!/usr/bin/env bash
#
# FET Trainer 一键启动脚本
# 在项目目录内启动本地静态服务器，并自动打开浏览器。
# 用法: ./start.sh        (默认端口 8000)
#       ./start.sh 8080   (指定端口)
#
set -euo pipefail

# ---- 1. 定位项目目录（无论从哪里调用，都基于脚本所在位置）----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${1:-8000}"

# ---- 2. 端口占用检测：被占用则自动 +1，最多尝试 20 次 ----
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "❌ 未找到 python3，请先安装 Python。" >&2
  exit 1
fi

# 探测函数：端口空闲输出 "free"，被占用输出 "used"；始终退出 0，避免触发 set -e
port_free() {
  "$PY" - "$1" <<'PYEOF'
import socket, sys
p = int(sys.argv[1])
s = socket.socket(); s.settimeout(0.3)
try:
    r = s.connect_ex(('127.0.0.1', p))
    print("free" if r != 0 else "used")
finally:
    s.close()
PYEOF
}

try_port="$PORT"
for _ in $(seq 1 20); do
  if [ "$(port_free "$try_port")" = "free" ]; then
    PORT="$try_port"
    break
  fi
  try_port=$((try_port + 1))
done

echo "📂 项目目录: $SCRIPT_DIR"
echo "🚀 启动本地服务器: http://localhost:$PORT"

# ---- 3. 启动服务器（后台），并注册退出清理 ----
"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "🛑 正在停止服务器 (PID $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  echo "👋 已退出。"
}
trap cleanup EXIT INT TERM

# ---- 4. 稍等服务器就绪后打开浏览器 ----
sleep 1
URL="http://localhost:$PORT"
if command -v open >/dev/null 2>&1; then
  open "$URL" || true          # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" || true      # Linux
elif command -v start >/dev/null 2>&1; then
  start "$URL" || true         # Windows
fi

echo "✅ 已打开浏览器。按 Ctrl+C 停止。"
wait "$SERVER_PID"
