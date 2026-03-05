#!/bin/bash
# RemoteView - Başlatma Scripti (macOS / Linux)
# Ortam değişkenleri:
#   RV_PORT=8765          WebSocket portu
#   RV_WEB_PORT=8080      HTTP(S) portu
#   RV_PASSWORD=gizli     Bağlantı şifresi
#   RV_TUNNEL=1           cloudflared veya ngrok ile NAT tüneli aç

cd "$(dirname "$0")"

echo ""
echo "🖥️  RemoteView Başlatıcı"
echo "---------------------------------------"

# Python kontrolü
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 bulunamadı. Kur: https://python.org"
    exit 1
fi

# Bağımlılıklar
echo "📦 Bağımlılıklar kontrol ediliyor..."
python3 -m pip install -q -r requirements.txt 2>/dev/null
if [ $? -ne 0 ]; then
    python3 -m pip install --user -q -r requirements.txt
fi

# ── NAT Tüneli (RV_TUNNEL=1 ile etkinleştir) ────────────────────────
CF_PID=""
NGROK_PID=""

if [ "${RV_TUNNEL}" = "1" ]; then
    WEB_PORT="${RV_WEB_PORT:-8080}"

    if command -v cloudflared &> /dev/null; then
        echo "🌍 cloudflared tüneli başlatılıyor..."
        cloudflared tunnel --url "http://localhost:${WEB_PORT}" 2>&1 | \
            grep --line-buffered -o 'https://[^ ]*\.trycloudflare\.com\|https://[^ ]*\.cloudflare\.com' | \
            while read url; do echo "  [🌍 Tünel] $url" ; done &
        CF_PID=$!
        sleep 2
    elif command -v ngrok &> /dev/null; then
        echo "🌍 ngrok tüneli başlatılıyor..."
        ngrok http "${WEB_PORT}" --log stdout &
        NGROK_PID=$!
        sleep 3
        NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | \
            python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null)
        [ -n "$NGROK_URL" ] && echo "  [🌍 Tünel] $NGROK_URL"
    else
        echo "⚠️  RV_TUNNEL=1 ama cloudflared veya ngrok bulunamadı."
        echo "    cloudflared: brew install cloudflared  (veya https://developers.cloudflare.com)"
        echo "    ngrok      : brew install ngrok/ngrok/ngrok  (veya https://ngrok.com/download)"
    fi
fi

echo ""
echo "🚀 RemoteView sunucusu başlatılıyor..."
echo "    http://localhost:${RV_WEB_PORT:-8080}"
echo ""

# Kapatınca tünelleri temizle
trap '[ -n "$CF_PID" ] && kill $CF_PID 2>/dev/null; [ -n "$NGROK_PID" ] && kill $NGROK_PID 2>/dev/null' EXIT

python3 server.py
