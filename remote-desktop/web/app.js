/**
 * RemoteView v2.0 — Web İstemcisi
 * Özellikler: Auth, Geçmiş, Chat, Clipboard, Dosya Sürükle-Bırak,
 *             Çift tıklama, Monitör seçimi, Sysinfo, Toast, Zoom,
 *             Tam ekran, Otomatik OS tuş çevirimi, Adaptif kalite
 */

class RemoteView {

    // ─── Yapıcı ───────────────────────────────────────────────
    constructor() {
        // Elementler — Bağlantı ekranı
        this.connectScreen    = document.getElementById('connect-screen');
        this.hostInput        = document.getElementById('server-host');
        this.portInput        = document.getElementById('server-port');
        this.passwordInput    = document.getElementById('server-password');
        this.btnConnect       = document.getElementById('btn-connect');
        this.connectError     = document.getElementById('connect-error');
        this.historySection   = document.getElementById('history-section');
        this.historyList      = document.getElementById('history-list');

        // Elementler — Uzak ekran
        this.remoteScreen     = document.getElementById('remote-screen');
        this.canvas           = document.getElementById('remote-canvas');
        this.ctx              = this.canvas.getContext('2d');
        this.dropOverlay      = document.getElementById('drop-overlay');
        this.reconnectOverlay = document.getElementById('reconnect-overlay');
        this.connectionStatus = document.getElementById('connection-status');
        this.osBadge          = document.getElementById('remote-os-badge');
        this.latencyDisplay   = document.getElementById('latency-display');
        this.fpsDisplay       = document.getElementById('fps-display');
        this.bandwidthDisplay = document.getElementById('bandwidth-display');
        this.zoomLabel        = document.getElementById('zoom-label');
        this.statsPanel       = document.getElementById('stats-panel');
        this.chatMessages     = document.getElementById('chat-messages');
        this.chatInput        = document.getElementById('chat-input');
        this.chatBadge        = document.getElementById('chat-badge');
        this.clipboardText    = document.getElementById('clipboard-text');
        this.monitorSelect    = document.getElementById('monitor-select');

        // Şifre modalı
        this.authModal       = document.getElementById('auth-modal');
        this.modalPassword   = document.getElementById('modal-password');
        this.modalError      = document.getElementById('modal-error');

        // WoL
        this.wolMac          = document.getElementById('wol-mac');
        this.wolBroadcast    = document.getElementById('wol-broadcast');
        this.wolStatus       = document.getElementById('wol-status');

        // Durum
        this.ws               = null;
        this.connected        = false;
        this.inputEnabled     = false;
        this.currentQuality   = 'low';
        this.monitorInfo      = null;
        this.remoteOS         = null;   // 'Darwin' | 'Windows' | 'Linux'
        this.zoom             = 1;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this._pendingPassword = '';

        // Chat
        this.unreadChat       = 0;
        this.chatOpen         = false;

        // Dosya alma
        this._fileChunks      = [];
        this._fileMeta        = null;

        // Performans metrikleri
        this.frameCount       = 0;
        this.byteCount        = 0;
        this.lastFpsTime      = performance.now();
        this.lastFpsCount     = 0;
        this.lastBandwidthTime  = performance.now();
        this.lastBandwidthBytes = 0;

        // Ping
        this.lastPingTime     = 0;
        this.latency          = 0;

        // E2E Şifreleme (WebCrypto API)
        this._e2eAesKey    = null;   // CryptoKey (AES-256-GCM)
        this._e2eEcdhKey   = null;   // ECDH keypair
        this._e2eReady     = false;
        this._requiresAuth = false;

        // Sayfa hangi IP'den açıldıysa host alanına otomatik yaz
        if (this.hostInput && !this.hostInput.value) {
            const h = window.location.hostname;
            this.hostInput.value = (h && h !== '') ? h : 'localhost';
        }
        // Port'u da sayfanın portuna göre ayarla
        if (this.portInput) {
            const p = window.location.port;
            this.portInput.value = (p && p !== '') ? p : '8080';
        }

        this._loadHistory();
        this.setupEventListeners();
        this.startMetricsLoop();
    }

    // ─── Olay Dinleyicileri ───────────────────────────────────
    setupEventListeners() {
        // Bağlantı ekranı
        this.btnConnect.addEventListener('click', () => this.connect());
        [this.hostInput, this.portInput, this.passwordInput].forEach(el =>
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connect(); })
        );

        // Toolbar butonları
        // WoL
        document.getElementById('btn-wol-send').addEventListener('click',  () => this.wolSend());
        document.getElementById('btn-wol-sleep').addEventListener('click', () => this.wolSleep());

        // Şifre modalı
        document.getElementById('btn-modal-submit').addEventListener('click', () => this.submitPassword());
        document.getElementById('btn-modal-cancel').addEventListener('click', () => { this.disconnect(); this.hidePasswordModal(); });
        this.modalPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitPassword(); });

        document.getElementById('btn-disconnect').addEventListener('click',   () => this.disconnect());
        document.getElementById('btn-input-toggle').addEventListener('click', () => this.toggleInput());
        document.getElementById('btn-fullscreen').addEventListener('click',   () => this.toggleFullscreen());
        document.getElementById('btn-stats').addEventListener('click',        () => this.toggleStats());
        document.getElementById('btn-shortcuts').addEventListener('click',    () => this.togglePanel('shortcuts-panel'));
        document.getElementById('btn-screenshot').addEventListener('click',   () => this.takeScreenshot());
        document.getElementById('btn-clipboard').addEventListener('click',    () => this.togglePanel('clipboard-panel'));
        document.getElementById('btn-chat').addEventListener('click',         () => this.openChat());
        document.getElementById('btn-sysinfo').addEventListener('click',      () => this.openSysinfo());
        document.getElementById('btn-zoom-in').addEventListener('click',      () => this.zoomBy(0.1));
        document.getElementById('btn-zoom-out').addEventListener('click',     () => this.zoomBy(-0.1));
        document.getElementById('btn-zoom-reset').addEventListener('click',   () => this.zoomReset());

        // Clipboard paneli
        document.getElementById('btn-clipboard-read').addEventListener('click',  () => this.clipboardRead());
        document.getElementById('btn-clipboard-write').addEventListener('click', () => this.clipboardWrite());

        // Chat
        document.getElementById('btn-chat-send').addEventListener('click', () => this.sendChat());
        this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChat(); });

        // Monitör seçici
        this.monitorSelect.addEventListener('change', () => {
            if (this.ws && this.connected)
                this.secureSend({ type: 'set_monitor', index: parseInt(this.monitorSelect.value) });
        });

        // Kalite butonları
        document.querySelectorAll('.quality-btn').forEach(btn =>
            btn.addEventListener('click', () => this.setQuality(btn.dataset.quality))
        );

        // Canvas fare olayları
        this.canvas.addEventListener('mousemove',   (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mousedown',   (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup',     (e) => this.onMouseUp(e));
        this.canvas.addEventListener('dblclick',    (e) => this.onDblClick(e));
        this.canvas.addEventListener('wheel',       (e) => this.onScroll(e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Klavye
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup',   (e) => this.onKeyUp(e));

        // Sürükle-bırak dosya yükleme
        const cc = document.getElementById('canvas-container');
        cc.addEventListener('dragover',  (e) => { e.preventDefault(); this.dropOverlay.classList.remove('hidden'); });
        cc.addEventListener('dragleave', ()  => this.dropOverlay.classList.add('hidden'));
        cc.addEventListener('drop',      (e) => this.onFileDrop(e));

        // Tam ekranda fare imlecini gizle
        document.addEventListener('fullscreenchange', () => {
            this.canvas.style.cursor = (document.fullscreenElement || this.inputEnabled) ? 'none' : 'default';
        });

        // Pencere boyutu
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    // ─── Bağlantı ─────────────────────────────────────────────
    connect() {
        const host     = this.hostInput.value.trim()     || window.location.hostname || 'localhost';
        const port     = this.portInput.value.trim()     || window.location.port || '8080';
        const password = this.passwordInput.value.trim() || '';
        const scheme   = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url      = `${scheme}://${host}:${port}`;

        this._pendingPassword = password;
        this.btnConnect.disabled    = true;
        this.btnConnect.textContent = 'Bağlanılıyor...';
        this.connectError.classList.add('hidden');

        try {
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                this.showRemoteScreen();
                this.startPingLoop();
                this._saveHistory(host, port);
            };

            this.ws.onmessage = (event) => this.onMessage(event);

            this.ws.onclose = () => {
                if (this.connected) this.onDisconnected();
                else this.showConnectError('Bağlantı kurulamadı — sunucuya ulaşılamıyor.');
            };

            this.ws.onerror = () => {
                if (!this.connected)
                    this.showConnectError('Sunucuya erişilemiyor. Adres ve portu kontrol edin.');
            };

        } catch (e) {
            this.showConnectError('Bağlantı hatası: ' + e.message);
        }
    }

    disconnect() {
        this.connected = false;
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.showConnectScreen();
    }

    onDisconnected() {
        this.connected = false;
        this.connectionStatus.className   = 'status disconnected';
        this.connectionStatus.textContent = '● Bağlantı Kesildi';

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectOverlay.classList.remove('hidden');
            this.reconnectAttempts++;
            setTimeout(() => { if (!this.connected) this.connect(); }, 2000 * this.reconnectAttempts);
        } else {
            this.showConnectScreen();
            this.showConnectError('Bağlantı kesildi. Tekrar deneyin.');
        }
    }

    // ─── Mesaj İşleme ─────────────────────────────────────────
    async onMessage(event) {
        if (event.data instanceof ArrayBuffer) {
            const view = new Uint8Array(event.data);
            if (view[0] === 0x01 && this._e2eAesKey) {
                // E2E şifreli binary kare
                try {
                    const dec = await this._e2eDecryptBin(event.data);
                    this.handleFrame(dec);
                } catch (e) { console.error('[E2E] Kare şifre çözme hatası:', e); }
            } else {
                this.handleFrame(event.data);
            }
        } else {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'e' && this._e2eAesKey) {
                    // E2E şifreli JSON
                    try {
                        const dec = await this._e2eDecryptJson(msg);
                        this.handleJsonMessage(dec);
                    } catch (e) { console.error('[E2E] JSON şifre çözme hatası:', e); }
                } else {
                    this.handleJsonMessage(msg);
                }
            } catch(e) {}
        }
    }

    handleFrame(buffer) {
        const view      = new DataView(buffer);
        const width     = view.getUint32(0);
        const height    = view.getUint32(4);
        const imageSize = view.getUint32(8);
        const blob      = new Blob([new Uint8Array(buffer, 12, imageSize)], { type: 'image/jpeg' });
        const url       = URL.createObjectURL(blob);
        const img       = new Image();
        img.onload = () => {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width  = width;
                this.canvas.height = height;
                this.resizeCanvas();
            }
            this.ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            this.frameCount++;
            this.byteCount += buffer.byteLength;
        };
        img.src = url;
    }

    handleJsonMessage(data) {
        switch (data.type) {

            case 'welcome':
                this.monitorInfo    = data.monitor;
                this.currentQuality = data.current_quality;
                this.inputEnabled   = data.input_enabled;
                this.remoteOS       = data.system?.os || null;
                this._populateMonitors(data.system?.monitors || []);
                this.updateInputButton();
                this.updateQualityButtons();
                this._updateOsBadge();
                if (data.requires_password)
                    this.showPasswordModal(false);
                break;

            case 'e2e_ready':
                this._e2eReady = true;
                this._showLock(true);
                this.toast('🔒 Uçtan uca şifreleme aktif (ECDH-P256 + AES-256-GCM)', 'success', 5000);
                // E2E hazır — şimdi şifre modalını göster
                if (this._requiresAuth) this.showPasswordModal(false);
                break;

            case 'auth_ok':
                this.hidePasswordModal();
                this.toast('🔐 Kimlik doğrulandı', 'success');
                break;

            case 'auth_fail':
                this.showPasswordModal(true);
                break;

            case 'quality_changed':
                this.currentQuality = data.preset;
                this.updateQualityButtons();
                if (data.auto) this.toast(`📶 Kalite otomatik: ${data.preset}`, 'info');
                break;

            case 'input_status':
                this.inputEnabled = data.enabled;
                this.updateInputButton();
                break;

            case 'monitor_changed':
                this.monitorInfo = data.monitor;
                this.toast(`🖥 Monitör ${data.monitor.index}`, 'info');
                break;

            case 'stats':
                this.updateStatsPanel(data);
                break;

            case 'pong':
                this.latency = Math.round(performance.now() - this.lastPingTime);
                this.latencyDisplay.textContent = this.latency + ' ms';
                if (this.ws && this.connected)
                    this.secureSend({ type: 'pong_latency', latency: this.latency });
                break;

            case 'chat_message':
                this._appendChat(data.from, data.message, data.ts, false);
                if (!this.chatOpen) {
                    this.unreadChat++;
                    this.chatBadge.textContent = this.unreadChat;
                    this.chatBadge.classList.remove('hidden');
                    this.toast(`💬 ${data.from}: ${data.message.substring(0, 60)}`, 'info');
                }
                break;

            case 'clipboard_data':
                this.clipboardText.value = data.text;
                this.togglePanel('clipboard-panel', true);
                this.toast('📋 Pano içeriği alındı', 'success');
                break;

            case 'clipboard_ack':
                this.toast('📋 ' + data.message, 'success');
                break;

            case 'clipboard_error':
                this.toast('❌ Pano: ' + data.message, 'error');
                break;

            case 'file_ack':
                if (data.action === 'saved')
                    this.toast(`✅ Kaydedildi: ${data.name} (${data.size_kb} KB)`, 'success');
                break;

            case 'file_incoming':
                this._fileChunks = [];
                this._fileMeta   = data;
                this.toast(`📥 Geliyor: ${data.name}`, 'info');
                break;

            case 'file_chunk':
                this._fileChunks.push(data.data);
                break;

            case 'file_done':
                this._saveReceivedFile(data.name);
                break;

            case 'file_error':
                this.toast('❌ Dosya: ' + data.message, 'error');
                break;

            case 'screenshot_saved':
                this.toast(`📷 Ekran görüntüsü: ${data.name}`, 'success');
                break;

            case 'sysinfo':
                this._renderSysinfo(data);
                break;

            case 'stream_paused':
                this.toast('⏸ Akış duraklatıldı', 'info');
                break;

            case 'stream_resumed':
                this.toast('▶ Akış devam ediyor', 'info');
                break;
        }
    }

    // ─── Ekran Yönetimi ───────────────────────────────────────
    showRemoteScreen() {
        this.connectScreen.classList.remove('active');
        this.remoteScreen.classList.add('active');
        this.reconnectOverlay.classList.add('hidden');
        this.connectionStatus.className   = 'status connected';
        this.connectionStatus.textContent = '● Bağlı';
        this.btnConnect.disabled          = false;
        this.btnConnect.textContent       = 'Bağlan';
    }

    showConnectScreen() {
        this.remoteScreen.classList.remove('active');
        this.connectScreen.classList.add('active');
        this.reconnectOverlay.classList.add('hidden');
        this.btnConnect.disabled    = false;
        this.btnConnect.textContent = 'Bağlan';
        this.statsPanel.classList.add('hidden');
        if (this.osBadge) this.osBadge.textContent = '';
        this._showLock(false);
        this._e2eReady  = false;
        this._e2eAesKey = null;
    }

    showConnectError(msg) {
        this.connectError.textContent = msg;
        this.connectError.classList.remove('hidden');
        this.btnConnect.disabled    = false;
        this.btnConnect.textContent = 'Bağlan';
    }

    resizeCanvas() {
        const container = document.getElementById('canvas-container');
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const iw = this.canvas.width;
        const ih = this.canvas.height;
        if (iw && ih) {
            const baseScale = Math.min(cw / iw, ch / ih);
            const scale     = baseScale * this.zoom;
            this.canvas.style.width  = Math.floor(iw * scale) + 'px';
            this.canvas.style.height = Math.floor(ih * scale) + 'px';
            this._displayScale       = baseScale;
        }
    }

    // ─── Kalite ───────────────────────────────────────────────
    setQuality(preset) {
        if (this.ws && this.connected)
            this.secureSend({ type: 'set_quality', preset });
    }

    updateQualityButtons() {
        document.querySelectorAll('.quality-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.quality === this.currentQuality)
        );
        const el = document.getElementById('stat-quality');
        if (el) el.textContent = this.currentQuality;
    }

    // ─── Girdi Kontrolü ───────────────────────────────────────
    toggleInput() {
        if (this.ws && this.connected)
            this.secureSend({ type: 'toggle_input' });
    }

    updateInputButton() {
        const btn = document.getElementById('btn-input-toggle');
        if (this.inputEnabled) {
            btn.className            = 'btn btn-sm btn-on';
            btn.innerHTML            = '🖱️ AÇIK';
            this.canvas.style.cursor = 'none';
        } else {
            btn.className            = 'btn btn-sm btn-off';
            btn.innerHTML            = '🖱️ KAPALI';
            this.canvas.style.cursor = 'default';
        }
    }

    // ─── OS Rozeti ────────────────────────────────────────────
    _updateOsBadge() {
        if (!this.remoteOS || !this.osBadge) return;
        const icons = { Darwin: '🍎', Windows: '🪟', Linux: '🐧' };
        this.osBadge.textContent = (icons[this.remoteOS] || '🖥') + ' ' + this.remoteOS;
    }

    // ─── Monitör ──────────────────────────────────────────────
    _populateMonitors(monitors) {
        if (!monitors.length) return;
        this.monitorSelect.innerHTML = '';
        monitors.forEach(m => {
            const opt       = document.createElement('option');
            opt.value       = m.index;
            opt.textContent = m.label;
            this.monitorSelect.appendChild(opt);
        });
    }

    // ─── Koordinat ────────────────────────────────────────────
    getCanvasCoords(e) {
        const rect   = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width  / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: Math.round((e.clientX - rect.left) * scaleX),
            y: Math.round((e.clientY - rect.top)  * scaleY)
        };
    }

    // ─── Fare ─────────────────────────────────────────────────
    onMouseMove(e) {
        if (!this.inputEnabled || !this.connected) return;
        const p = this.getCanvasCoords(e);
        this.sendInput({ type: 'mousemove', x: p.x, y: p.y });
    }

    onMouseDown(e) {
        if (!this.inputEnabled || !this.connected) return;
        e.preventDefault();
        const p = this.getCanvasCoords(e);
        this.sendInput({ type: 'mousedown', x: p.x, y: p.y, button: e.button });
    }

    onMouseUp(e) {
        if (!this.inputEnabled || !this.connected) return;
        const p = this.getCanvasCoords(e);
        this.sendInput({ type: 'mouseup', x: p.x, y: p.y, button: e.button });
    }

    onDblClick(e) {
        if (!this.inputEnabled || !this.connected) return;
        e.preventDefault();
        const p = this.getCanvasCoords(e);
        this.sendInput({ type: 'dblclick', x: p.x, y: p.y });
    }

    onScroll(e) {
        if (!this.connected) return;
        e.preventDefault();
        if (e.ctrlKey) { this.zoomBy(e.deltaY < 0 ? 0.1 : -0.1); return; }
        if (!this.inputEnabled) return;
        const p = this.getCanvasCoords(e);
        this.sendInput({ type: 'scroll', x: p.x, y: p.y, deltaY: e.deltaY, deltaX: e.deltaX });
    }

    // ─── Klavye ───────────────────────────────────────────────
    onKeyDown(e) {
        if (this.connected) {
            const ca = e.ctrlKey && e.altKey;
            if (ca) {
                switch (e.key.toLowerCase()) {
                    case 'f': e.preventDefault(); this.toggleFullscreen();              return;
                    case 'i': e.preventDefault(); this.toggleInput();                   return;
                    case 's': e.preventDefault(); this.takeScreenshot();                return;
                    case 'x': e.preventDefault(); this.togglePanel('clipboard-panel'); return;
                    case 'c': e.preventDefault(); this.openChat();                      return;
                    case 'q': e.preventDefault(); this.toggleStats();                   return;
                    case 'k': e.preventDefault(); this.togglePanel('shortcuts-panel'); return;
                    case 'd': e.preventDefault(); this.disconnect();                    return;
                    case '=':
                    case '+': e.preventDefault(); this.zoomBy(0.1);                    return;
                    case '-': e.preventDefault(); this.zoomBy(-0.1);                   return;
                    case '0': e.preventDefault(); this.zoomReset();                    return;
                }
            }
        }
        if (!this.inputEnabled || !this.connected) return;
        if (['F5', 'F12'].includes(e.key)) return;  // tarayıcı kısayollarını koru
        e.preventDefault();
        this.sendInput({ type: 'keydown', ...this._mapKeys(e) });
    }

    onKeyUp(e) {
        if (!this.inputEnabled || !this.connected) return;
        e.preventDefault();
        const m = this._mapKeys(e);
        this.sendInput({ type: 'keyup', key: m.key, code: e.code });
    }

    /** Mac/Win/Linux otomatik tuş çevirimi */
    _mapKeys(e) {
        const rMac  = this.remoteOS === 'Darwin';
        const lMac  = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Mac');
        let ctrlKey = e.ctrlKey, metaKey = e.metaKey, key = e.key;
        if (lMac && !rMac) {
            if (e.metaKey) { ctrlKey = true; metaKey = false; }
            if (key === 'Meta') key = 'Control';
        }
        if (!lMac && rMac) {
            if (e.ctrlKey) { metaKey = true; ctrlKey = false; }
            if (key === 'Control') key = 'Meta';
        }
        return { key, code: e.code, ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey };
    }

    sendInput(data) {
        this.secureSend(data);
    }

    // ─── Sürükle-Bırak Dosya ──────────────────────────────────
    onFileDrop(e) {
        e.preventDefault();
        this.dropOverlay.classList.add('hidden');
        if (!this.connected || !this.ws) { this.toast('Önce bağlanın', 'warning'); return; }
        Array.from(e.dataTransfer.files).forEach(f => this._uploadFile(f));
    }

    _uploadFile(file) {
        const CHUNK = 64 * 1024;
        const reader = new FileReader();
        reader.onload = () => {
            const buf = reader.result;
            this.secureSend({ type: 'file_transfer', action: 'start', name: file.name });
            let offset = 0;
            const send = () => {
                if (offset >= buf.byteLength) {
                    this.secureSend({ type: 'file_transfer', action: 'end' });
                    this.toast(`📤 Gönderildi: ${file.name}`, 'success');
                    return;
                }
                const b64 = btoa(String.fromCharCode(...new Uint8Array(buf.slice(offset, offset + CHUNK))));
                this.secureSend({ type: 'file_transfer', action: 'chunk', data: b64 });
                offset += CHUNK;
                setTimeout(send, 0);
            };
            send();
        };
        reader.readAsArrayBuffer(file);
        this.toast(`📤 ${file.name} gönderiliyor...`, 'info');
    }

    _saveReceivedFile(name) {
        if (!this._fileChunks.length) return;
        const bytes = this._fileChunks.map(b64 => {
            const bin  = atob(b64);
            const arr  = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
        });
        const blob = new Blob(bytes, { type: this._fileMeta?.mime || 'application/octet-stream' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        this._fileChunks = [];
        this._fileMeta   = null;
        this.toast(`💾 İndirildi: ${name}`, 'success');
    }
    // ─── E2E Şifreleme ─────────────────────────────────────────

    /** Gönderim yardımcısı: E2E aktifse şifreli, değilse düz gönderir. */
    secureSend(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
        if (!this._e2eAesKey) {
            this.ws.send(jsonStr);
            return;
        }
        // Async şifreleme — fire-and-forget
        const enc = new TextEncoder().encode(jsonStr);
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode('json') },
            this._e2eAesKey, enc
        ).then(ct => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN)
                this.ws.send(JSON.stringify({
                    type: 'e',
                    n: btoa(String.fromCharCode(...nonce)),
                    d: btoa(String.fromCharCode(...new Uint8Array(ct)))
                }));
        }).catch(e => console.error('[E2E] Şifrele:', e));
    }

    /** Sunucudan gelen şifreli JSON mesajını çözer. */
    async _e2eDecryptJson(msg) {
        const nonce = Uint8Array.from(atob(msg.n), c => c.charCodeAt(0));
        const ct    = Uint8Array.from(atob(msg.d), c => c.charCodeAt(0));
        const dec   = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode('json') },
            this._e2eAesKey, ct
        );
        return JSON.parse(new TextDecoder().decode(dec));
    }

    /** Sunucudan gelen şifreli binary kareyi çözer. */
    async _e2eDecryptBin(buffer) {
        const nonce = buffer.slice(1, 13);
        const ct    = buffer.slice(13);
        return await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode('bin') },
            this._e2eAesKey, ct
        );
    }

    /** ECDH-P256 anahtar değişimi — sunucuyla ortak AES-256-GCM anahtarı türetir. */
    async _setupE2E(serverPubKeyB64) {
        try {
            // İstemci ECDH çifti üret
            this._e2eEcdhKey = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
            );
            // İstemci public key'i export et (uncompressed X9.62, 65 byte)
            const rawPub = await crypto.subtle.exportKey('raw', this._e2eEcdhKey.publicKey);
            const pubB64 = btoa(String.fromCharCode(...new Uint8Array(rawPub)));
            // Sunucu public key'i import et
            const srvPub = await crypto.subtle.importKey(
                'raw',
                Uint8Array.from(atob(serverPubKeyB64), c => c.charCodeAt(0)),
                { name: 'ECDH', namedCurve: 'P-256' },
                false, []
            );
            // Paylaşılan AES-256-GCM anahtarını türet
            this._e2eAesKey = await crypto.subtle.deriveKey(
                { name: 'ECDH', public: srvPub },
                this._e2eEcdhKey.privateKey,
                { name: 'AES-GCM', length: 256 },
                false, ['encrypt', 'decrypt']
            );
            // Kendi public key'imizi sunucuya gönder (düz — henüz E2E hazır değil)
            this.ws.send(JSON.stringify({ type: 'e2e_init', pub: pubB64 }));
        } catch (e) {
            console.error('[E2E] Kurulum hatası:', e);
            this.toast('⚠️ E2E şifreleme başlatamadı', 'warning');
            // E2E olmadan devam et
            if (this._requiresAuth) this.showPasswordModal(false);
        }
    }

    /** Kilit simgesini günceller. */
    _showLock(active) {
        const el = document.getElementById('e2e-lock');
        if (!el) return;
        if (active) {
            el.textContent = '🔒';
            el.title       = 'Uçtan uca şifreli (ECDH-P256 + AES-256-GCM)';
            el.classList.add('lock-active');
        } else {
            el.textContent = '🔓';
            el.title       = 'Şifreleme yok';
            el.classList.remove('lock-active');
        }
    }

    // ─── Wake-on-LAN ───────────────────────────────────────────
    async wolSend() {
        const mac = (this.wolMac.value || '').trim();
        if (!mac) { this._wolStatus('MAC adresi gerekli', 'error'); return; }
        // Basit format doğrulama: XX:XX:XX:XX:XX:XX veya XX-XX-XX-XX-XX-XX
        if (!/^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
            this._wolStatus('Geçersiz MAC formatı (XX:XX:XX:XX:XX:XX)', 'error');
            return;
        }
        const bcast  = (this.wolBroadcast.value || '255.255.255.255').trim();
        const host   = (this.hostInput.value || window.location.hostname || 'localhost').trim();
        const port   = window.location.port || '8080';
        const scheme = window.location.protocol;
        this._wolStatus('🔄 Magic Packet gönderiliyor...', 'info');
        try {
            const params = new URLSearchParams({ mac, broadcast: bcast });
            const res = await fetch(`${scheme}//${host}:${port}/api/wol?${params}`);
            const data = await res.json();
            if (data.ok) this._wolStatus(`✅ Magic Packet gönderildi → ${data.mac}`, 'success');
            else          this._wolStatus('❌ ' + data.error, 'error');
        } catch (e) {
            this._wolStatus('❌ Sunucuya ulaşılamadı: ' + e.message, 'error');
        }
    }

    async wolSleep() {
        if (!confirm('Sunucu makinesi uyku moduna alınacak. Emin misiniz?')) return;
        const host   = (this.hostInput.value || window.location.hostname || 'localhost').trim();
        const port   = window.location.port || '8080';
        const scheme = window.location.protocol;
        this._wolStatus('💤 Uyku komutu gönderiliyor...', 'info');
        try {
            const res  = await fetch(`${scheme}//${host}:${port}/api/sleep`);
            const data = await res.json();
            this._wolStatus('💤 ' + (data.message || 'Uyku moduna geçiyor...'), 'success');
            if (this.connected) setTimeout(() => this.disconnect(), 2000);
        } catch (e) {
            this._wolStatus('❌ ' + e.message, 'error');
        }
    }

    _wolStatus(msg, type) {
        const colors = { success: '#1a7a3c', error: '#8b1a1a', info: '#1a4a7a', warning: '#7a5a00' };
        this.wolStatus.textContent    = msg;
        this.wolStatus.style.color    = colors[type] || '';
        this.wolStatus.classList.remove('hidden');
        if (type === 'success' || type === 'info')
            setTimeout(() => this.wolStatus.classList.add('hidden'), 5000);
    }

    // ─── Şifre Modalı ─────────────────────────────────────────
    showPasswordModal(isRetry = false) {
        this.modalError.classList.toggle('hidden', !isRetry);
        // Bağlantı formunda önceden girilmiş şifre varsa modalı doldur
        const prefilled = this._pendingPassword || '';
        this.modalPassword.value = isRetry ? '' : prefilled;
        this.authModal.classList.remove('hidden');
        setTimeout(() => this.modalPassword.focus(), 80);
        // Eğer şifre önceden doluysa Enter beklemesin, otomatik dene
        if (!isRetry && prefilled) {
            this.submitPassword();
        }
    }

    hidePasswordModal() {
        this.authModal.classList.add('hidden');
        this.modalPassword.value = '';
        this.modalError.classList.add('hidden');
    }

    submitPassword() {
        const pwd = this.modalPassword.value;
        if (!this.ws || !this.connected) { this.hidePasswordModal(); return; }
        this.secureSend({ type: 'auth', password: pwd });
    }
    // ─── Ekran Görüntüsü ──────────────────────────────────────
    takeScreenshot() {
        if (!this.ws || !this.connected) { this.toast('Bağlı değilsiniz', 'warning'); return; }
        this.secureSend({ type: 'take_screenshot' });
        this.toast('📷 Ekran görüntüsü alınıyor...', 'info');
    }

    // ─── Chat ─────────────────────────────────────────────────
    openChat() {
        this.togglePanel('chat-panel');
        this.chatOpen = !document.getElementById('chat-panel').classList.contains('hidden');
        if (this.chatOpen) {
            this.unreadChat = 0;
            this.chatBadge.classList.add('hidden');
            this.chatInput.focus();
        }
    }

    sendChat() {
        const msg = this.chatInput.value.trim();
        if (!msg || !this.ws || !this.connected) return;
        this.secureSend({ type: 'chat', message: msg });
        this._appendChat('Ben', msg, null, true);
        this.chatInput.value = '';
    }

    _appendChat(from, message, ts, isSelf) {
        const div     = document.createElement('div');
        div.className = 'chat-msg ' + (isSelf ? 'chat-self' : 'chat-other');
        const time    = ts || new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `<span class="chat-from">${from}</span>` +
                        `<span class="chat-text">${this._esc(message)}</span>` +
                        `<span class="chat-time">${time}</span>`;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    _esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ─── Clipboard ────────────────────────────────────────────
    clipboardRead()  { if (this.ws && this.connected) this.secureSend({ type: 'clipboard', action: 'read' }); }
    clipboardWrite() { if (this.ws && this.connected) this.secureSend({ type: 'clipboard', action: 'write', text: this.clipboardText.value }); }

    // ─── Sysinfo ──────────────────────────────────────────────
    openSysinfo() {
        this.togglePanel('sysinfo-panel', true);
        if (this.ws && this.connected)
            this.secureSend({ type: 'get_sysinfo' });
    }

    _renderSysinfo(data) {
        const el = document.getElementById('sysinfo-content');
        if (!el) return;
        this.togglePanel('sysinfo-panel', true);
        el.innerHTML =
            `<div class="stat-row"><span>Bilgisayar Adı</span><span>${data.hostname}</span></div>` +
            `<div class="stat-row"><span>İşletim Sistemi</span><span>${data.os} ${data.os_ver}</span></div>` +
            `<div class="stat-row"><span>Mimari</span><span>${data.arch}</span></div>` +
            `<div class="stat-row"><span>Monitör Sayısı</span><span>${data.monitors?.length || 1}</span></div>` +
            `<div class="stat-row"><span>Clipboard</span><span>${data.clipboard ? '✅' : '❌ kurulu değil'}</span></div>` +
            `<div class="stat-row"><span>Fare/Klavye</span><span>${data.input ? '✅' : '❌ kurulu değil'}</span></div>` +
            `<div class="stat-row"><span>Sürüm</span><span>v${data.version}</span></div>`;
    }

    // ─── Panel ────────────────────────────────────────────────
    togglePanel(id, force) {
        const el = document.getElementById(id);
        if (!el) return;
        if      (force === true)  el.classList.remove('hidden');
        else if (force === false) el.classList.add('hidden');
        else                      el.classList.toggle('hidden');
    }

    // ─── Zoom ─────────────────────────────────────────────────
    zoomBy(delta) {
        this.zoom = Math.max(0.25, Math.min(4, this.zoom + delta));
        if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
        this.resizeCanvas();
    }

    zoomReset() {
        this.zoom = 1;
        if (this.zoomLabel) this.zoomLabel.textContent = '100%';
        this.resizeCanvas();
    }

    // ─── Tam Ekran ────────────────────────────────────────────
    toggleFullscreen() {
        if (!document.fullscreenElement)
            this.remoteScreen.requestFullscreen().catch(() => {});
        else
            document.exitFullscreen();
    }

    // ─── İstatistikler ────────────────────────────────────────
    toggleStats() {
        this.statsPanel.classList.toggle('hidden');
        if (!this.statsPanel.classList.contains('hidden') && this.ws && this.connected)
            this.secureSend({ type: 'get_stats' });
    }

    updateStatsPanel(data) {
        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('stat-frames',  (data.frames_sent || 0).toLocaleString());
        s('stat-data',    (data.mb_sent    || 0) + ' MB');
        s('stat-avgfps',  data.avg_fps     || 0);
        s('stat-uptime',  this.formatDuration(data.uptime_seconds || 0));
        s('stat-quality', this.currentQuality);
        s('stat-latency', this.latency + ' ms');
        s('stat-clients', data.connected_clients || '--');
    }

    formatDuration(s) {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        if (h > 0) return `${h}sa ${m}dk ${sec}sn`;
        if (m > 0) return `${m}dk ${sec}sn`;
        return `${sec}sn`;
    }

    // ─── Toast ────────────────────────────────────────────────
    toast(message, type = 'info', duration = 3500) {
        const c  = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        c.appendChild(el);
        requestAnimationFrame(() => el.classList.add('toast-show'));
        setTimeout(() => {
            el.classList.remove('toast-show');
            setTimeout(() => el.remove(), 400);
        }, duration);
    }

    // ─── Geçmiş ───────────────────────────────────────────────
    _saveHistory(host, port) {
        let h   = JSON.parse(localStorage.getItem('rv_history') || '[]');
        const k = `${host}:${port}`;
        h       = h.filter(i => i.key !== k);
        h.unshift({ key: k, host, port, ts: Date.now() });
        localStorage.setItem('rv_history', JSON.stringify(h.slice(0, 8)));
        this._renderHistory(h.slice(0, 8));
    }

    _loadHistory() {
        const h = JSON.parse(localStorage.getItem('rv_history') || '[]');
        if (h.length) this._renderHistory(h);
    }

    _renderHistory(h) {
        if (!h.length) return;
        this.historySection.classList.remove('hidden');
        this.historyList.innerHTML = '';
        h.forEach(item => {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `<span class="history-addr">${item.host}:${item.port}</span>` +
                           `<span class="history-time">${this._relTime(item.ts)}</span>` +
                           `<button class="history-del" title="Sil">✕</button>`;
            li.querySelector('.history-addr').addEventListener('click', () => {
                this.hostInput.value = item.host;
                this.portInput.value = item.port;
                this.connect();
            });
            li.querySelector('.history-del').addEventListener('click', (e) => {
                e.stopPropagation();
                let hh = JSON.parse(localStorage.getItem('rv_history') || '[]');
                hh = hh.filter(i => i.key !== item.key);
                localStorage.setItem('rv_history', JSON.stringify(hh));
                li.remove();
                if (!this.historyList.children.length)
                    this.historySection.classList.add('hidden');
            });
            this.historyList.appendChild(li);
        });
    }

    _relTime(ts) {
        const d = Date.now() - ts, m = Math.floor(d / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
        if (dd > 0) return `${dd}g önce`;
        if (h  > 0) return `${h}sa önce`;
        if (m  > 0) return `${m}dk önce`;
        return 'az önce';
    }

    // ─── Döngüler ─────────────────────────────────────────────
    startPingLoop() {
        setInterval(() => {
            if (this.ws && this.connected) {
                this.lastPingTime = performance.now();
                this.secureSend({ type: 'ping' });
            }
        }, 3000);
    }

    startMetricsLoop() {
        setInterval(() => {
            const now = performance.now();
            const fpsDt = (now - this.lastFpsTime) / 1000;
            if (fpsDt > 0) {
                this.fpsDisplay.textContent = Math.round((this.frameCount - this.lastFpsCount) / fpsDt) + ' FPS';
                this.lastFpsCount = this.frameCount;
                this.lastFpsTime  = now;
            }
            const bwDt = (now - this.lastBandwidthTime) / 1000;
            if (bwDt > 0) {
                const kbps = Math.round((this.byteCount - this.lastBandwidthBytes) / bwDt / 1024);
                this.bandwidthDisplay.textContent = kbps + ' KB/s';
                this.lastBandwidthBytes = this.byteCount;
                this.lastBandwidthTime  = now;
            }
            if (!this.statsPanel.classList.contains('hidden') && this.ws && this.connected)
                this.secureSend({ type: 'get_stats' });
        }, 1000);
    }
}

// ─── Başlat ───────────────────────────────────────────────────
const app = new RemoteView();
