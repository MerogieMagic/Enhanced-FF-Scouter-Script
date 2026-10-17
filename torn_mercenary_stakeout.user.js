// ==UserScript==
// @name         Torn City - Mercenary Stakeout Radar
// @namespace    Violentmonkey Scripts
// @version      1.00
// @description  Precision mercenary target stakeout radar: live multi-target tracking for hospital discharge, online activity, flight landings, absolute HP, and instant audio alarms with 1-click attack staging.
// @author       Merogie & Antigravity
// @match        https://www.torn.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate execution
    if (window.__TORN_MERCENARY_STAKEOUT_LOADED__) return;
    window.__TORN_MERCENARY_STAKEOUT_LOADED__ = true;

    // --- 1. STORAGE & POLYFILLS ---
    function safeAddStyle(css) {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    function getStorage(key, defaultValue) {
        try {
            if (typeof GM_getValue === 'function') {
                const val = GM_getValue(key, null);
                if (val !== null && val !== undefined) return val;
            }
        } catch (e) {}
        try {
            const local = localStorage.getItem(`stakeout_${key}`);
            if (local !== null && local !== undefined) return JSON.parse(local);
        } catch (e) {}
        return defaultValue;
    }

    function setStorage(key, value) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(key, value);
        } catch (e) {}
        try {
            localStorage.setItem(`stakeout_${key}`, JSON.stringify(value));
        } catch (e) {}
    }

    function getApiKey() {
        return getStorage('api_key', '') ||
               getStorage('limited_key', '') ||
               localStorage.getItem('twse-config-apikey') ||
               localStorage.getItem('limited_key') ||
               localStorage.getItem('torn_api_key') || '';
    }

    // --- 2. CONFIGURATION & STATE ---
    const DEFAULT_CONFIG = {
        alertOnOkay: true,
        alertOnOnline: true,
        alertOnLanding: true,
        alertOnFullHp: false,
        soundAlarm: true,
        desktopNotif: true,
        autoOpenAttack: false,
        rapidHospPolling: true,
        pollingInterval: 5, // seconds
        isPaused: false,
        isMinimized: false
    };

    let config = Object.assign({}, DEFAULT_CONFIG, getStorage('config', {}));
    function saveConfig() {
        setStorage('config', config);
    }

    let watchlist = getStorage('watchlist', [
        // Array of target IDs (strings)
    ]);
    function saveWatchlist() {
        setStorage('watchlist', watchlist);
    }

    // Target telemetry memory cache: id -> { data, lastChecked, previous }
    const targetsCache = {};
    // Rate limit tracking: [timestamps]
    const callLog = [];

    function recordApiCall() {
        const now = Date.now();
        callLog.push(now);
        // Keep only calls within the last 60 seconds
        while (callLog.length > 0 && callLog[0] < now - 60000) {
            callLog.shift();
        }
    }

    function getApiCallRate() {
        const now = Date.now();
        while (callLog.length > 0 && callLog[0] < now - 60000) {
            callLog.shift();
        }
        return callLog.length;
    }

    // --- 3. AUDIO ENGINE (Synthesized Zero-Dependency Web Audio) ---
    function playStakeoutAlarm(type = 'okay') {
        if (!config.soundAlarm) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            if (type === 'okay') {
                // High-priority dual-chime for attackable target (880Hz -> 1320Hz -> 1760Hz)
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'sine';
                osc2.type = 'triangle';
                osc1.frequency.setValueAtTime(880, ctx.currentTime);
                osc1.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
                osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.15);
                osc2.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.35);

                gain.gain.setValueAtTime(0.35, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(ctx.currentTime);
                osc2.start(ctx.currentTime + 0.15);
                osc1.stop(ctx.currentTime + 0.15);
                osc2.stop(ctx.currentTime + 0.55);
            } else if (type === 'online') {
                // Distinct ascending chirp (523Hz -> 659Hz)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, ctx.currentTime);
                osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.25, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.35);
            } else {
                // Triple warning beeps
                for (let i = 0; i < 3; i++) {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const start = ctx.currentTime + (i * 0.14);
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(980, start);
                    gain.gain.setValueAtTime(0.2, start);
                    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.1);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(start);
                    osc.stop(start + 0.1);
                }
            }
        } catch (e) {
            console.error('[Stakeout] Audio error:', e);
        }
    }

    // --- 4. DESKTOP NOTIFICATIONS ---
    function sendStakeoutNotification(title, body, url) {
        if (!config.desktopNotif) return;
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    title: `🎯 Stakeout: ${title}`,
                    text: body,
                    timeout: 8000,
                    onclick: () => {
                        if (url) window.open(url, '_blank');
                    }
                });
                return;
            }
        } catch (e) {}

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                const notif = new Notification(`🎯 Stakeout: ${title}`, {
                    body: body,
                    icon: 'https://www.torn.com/favicon.ico'
                });
                if (url) {
                    notif.onclick = () => window.open(url, '_blank');
                }
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission();
            }
        }
    }

    // --- 5. TORN API POLLER & TELEMETRY ---
    async function fetchTargetTelemetry(targetId) {
        const apiKey = getApiKey();
        if (!apiKey) return null;

        // Rate limit guard (max 90 calls/min)
        if (getApiCallRate() >= 90) {
            console.warn('[Stakeout] Rate limit threshold reached, skipping cycle');
            return null;
        }

        try {
            recordApiCall();
            const url = `https://api.torn.com/user/${targetId}?selections=profile,basic&key=${apiKey}&comment=StakeoutRadar`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.error) {
                console.error('[Stakeout] API error:', data.error);
                return { error: data.error.error || 'API Error', code: data.error.code };
            }
            return data;
        } catch (e) {
            console.error('[Stakeout] Network error:', e);
            return null;
        }
    }

    // --- 6. TRIGGER EVALUATION ENGINE ---
    function evaluateTargetTriggers(targetId, freshData) {
        if (!freshData || freshData.error) return;

        const currentSnapshot = {
            name: freshData.name || `Player [${targetId}]`,
            state: freshData.status?.state || 'Okay',
            desc: freshData.status?.description || '',
            until: parseInt(freshData.status?.until || '0', 10),
            online: freshData.last_action?.status || 'Offline',
            lastActionRel: freshData.last_action?.relative || '',
            hpCurr: freshData.life?.current || 0,
            hpMax: freshData.life?.maximum || 0,
            hpPct: (freshData.life?.maximum > 0) ? (freshData.life.current / freshData.life.maximum) * 100 : 100,
            level: freshData.level || 0
        };

        const existing = targetsCache[targetId];
        const previous = existing ? existing.data : null;

        if (previous) {
            // Trigger 1: Target becomes OKAY (Hosp -> Okay)
            if (config.alertOnOkay && previous.state !== 'Okay' && currentSnapshot.state === 'Okay') {
                playStakeoutAlarm('okay');
                sendStakeoutNotification(
                    `${currentSnapshot.name} is OKAY!`,
                    `Target discharged or medded out of hospital! Click to launch attack.`,
                    `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`
                );
                if (config.autoOpenAttack) {
                    window.open(`https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`, '_blank');
                }
            }

            // Trigger 2: Target comes ONLINE (Offline -> Online/Idle)
            if (config.alertOnOnline && previous.online === 'Offline' && (currentSnapshot.online === 'Online' || currentSnapshot.online === 'Idle')) {
                playStakeoutAlarm('online');
                sendStakeoutNotification(
                    `${currentSnapshot.name} is ONLINE!`,
                    `Activity detected (${currentSnapshot.online}): ${currentSnapshot.lastActionRel}`,
                    `https://www.torn.com/profiles.php?XID=${targetId}`
                );
            }

            // Trigger 3: Target LANDS from Flight (Traveling -> Okay / Abroad)
            if (config.alertOnLanding && previous.state === 'Traveling' && currentSnapshot.state !== 'Traveling') {
                playStakeoutAlarm('okay');
                sendStakeoutNotification(
                    `${currentSnapshot.name} LANDED!`,
                    `Flight arrived: now ${currentSnapshot.state} (${currentSnapshot.desc})`,
                    `https://www.torn.com/profiles.php?XID=${targetId}`
                );
            }

            // Trigger 4: Target reaches Full HP
            if (config.alertOnFullHp && previous.hpPct < 100 && currentSnapshot.hpPct >= 100) {
                playStakeoutAlarm('online');
                sendStakeoutNotification(
                    `${currentSnapshot.name} reached 100% HP!`,
                    `Life fully recovered: ${currentSnapshot.hpCurr.toLocaleString()} / ${currentSnapshot.hpMax.toLocaleString()}`,
                    `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`
                );
            }
        }

        targetsCache[targetId] = {
            data: currentSnapshot,
            lastChecked: Date.now()
        };

        updateTargetCardUI(targetId);
        updateRadarBadge();
    }

    // --- 7. STYLES (Modern Dark Tactical Radar) ---
    safeAddStyle(`
        /* Stakeout Radar Floating Badge / Dock */
        #torn-stakeout-dock {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, monospace;
            user-select: none;
        }

        /* Minimized Pill */
        .stakeout-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            border: 1px solid #3b82f6;
            color: #f8fafc;
            padding: 8px 14px;
            border-radius: 30px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 10px rgba(59, 130, 246, 0.3);
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 13px;
            font-weight: 700;
        }
        .stakeout-pill:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7), 0 0 15px rgba(59, 130, 246, 0.5);
            border-color: #60a5fa;
        }
        .stakeout-pill.has-ready {
            border-color: #22c55e;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 12px rgba(34, 197, 94, 0.5);
            animation: stakeoutPillPulse 1.4s infinite ease-in-out;
        }
        @keyframes stakeoutPillPulse {
            0% { box-shadow: 0 0 4px #22c55e; }
            50% { box-shadow: 0 0 14px #22c55e, 0 0 6px #16a34a; }
            100% { box-shadow: 0 0 4px #22c55e; }
        }

        .stakeout-radar-icon {
            display: inline-block;
            font-size: 15px;
            animation: radarRotate 4s linear infinite;
        }
        @keyframes radarRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Expanded Window */
        .stakeout-window {
            width: 360px;
            max-width: 92vw;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 1px rgba(255, 255, 255, 0.1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            max-height: 85vh;
        }

        .stakeout-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            padding: 10px 14px;
            border-bottom: 1px solid #334155;
        }
        .stakeout-title {
            font-size: 13.5px;
            font-weight: 800;
            color: #f8fafc;
            display: flex;
            align-items: center;
            gap: 6px;
            letter-spacing: 0.3px;
        }
        .stakeout-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .stakeout-btn-icon {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #cbd5e1;
            border-radius: 5px;
            padding: 3px 7px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s ease;
        }
        .stakeout-btn-icon:hover {
            background: rgba(255, 255, 255, 0.18);
            color: #ffffff;
        }

        /* Target Add Bar */
        .stakeout-add-bar {
            display: flex;
            gap: 6px;
            padding: 8px 12px;
            background: #1e293b;
            border-bottom: 1px solid #334155;
        }
        .stakeout-input {
            flex: 1;
            background: #0f172a;
            border: 1px solid #475569;
            color: #f8fafc;
            padding: 6px 10px;
            border-radius: 5px;
            font-size: 12px;
            outline: none;
        }
        .stakeout-input:focus {
            border-color: #3b82f6;
        }
        .stakeout-btn-primary {
            background: #2563eb;
            border: 1px solid #3b82f6;
            color: #ffffff;
            font-size: 11.5px;
            font-weight: 700;
            padding: 6px 12px;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .stakeout-btn-primary:hover {
            background: #1d4ed8;
        }

        /* Target Cards Container */
        .stakeout-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .stakeout-empty {
            color: #94a3b8;
            font-size: 12px;
            text-align: center;
            padding: 24px 12px;
            line-height: 1.5;
        }

        /* Target Card */
        .stakeout-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 7px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: all 0.2s ease;
        }
        .stakeout-card.ready {
            border-color: #22c55e;
            box-shadow: 0 0 10px rgba(34, 197, 94, 0.35);
            background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, #1e293b 100%);
        }
        .stakeout-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .stakeout-card-name {
            font-size: 13px;
            font-weight: 800;
            color: #f8fafc;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .stakeout-card-name:hover {
            color: #38bdf8;
            text-decoration: underline;
        }
        .stakeout-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        .stakeout-dot.online { background: #22c55e; box-shadow: 0 0 5px #22c55e; }
        .stakeout-dot.idle { background: #f59e0b; }
        .stakeout-dot.offline { background: #64748b; }

        .stakeout-card-badges {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
        }

        .stakeout-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 4px;
            font-family: monospace, monospace;
            font-weight: 800;
            font-size: 11.5px;
        }
        .stakeout-status-pill.okay {
            background: rgba(34, 197, 94, 0.25);
            border: 1px solid #22c55e;
            color: #86efac;
            animation: stakeoutPillPulse 1.2s infinite ease-in-out;
        }
        .stakeout-status-pill.hospital {
            background: rgba(239, 68, 68, 0.25);
            border: 1px solid #ef4444;
            color: #fca5a5;
        }
        .stakeout-status-pill.traveling {
            background: rgba(245, 158, 11, 0.25);
            border: 1px solid #f59e0b;
            color: #fde047;
        }
        .stakeout-status-pill.abroad {
            background: rgba(59, 130, 246, 0.25);
            border: 1px solid #3b82f6;
            color: #93c5fd;
        }

        /* Health Bar */
        .stakeout-hp-bar-wrap {
            height: 14px;
            background: #0f172a;
            border-radius: 4px;
            position: relative;
            overflow: hidden;
            border: 1px solid #334155;
            display: flex;
            align-items: center;
        }
        .stakeout-hp-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #15803d 0%, #22c55e 100%);
            transition: width 0.3s ease;
        }
        .stakeout-hp-bar-fill.warning {
            background: linear-gradient(90deg, #b45309 0%, #eab308 100%);
        }
        .stakeout-hp-bar-fill.danger {
            background: linear-gradient(90deg, #991b1b 0%, #ef4444 100%);
        }
        .stakeout-hp-text {
            position: absolute;
            width: 100%;
            text-align: center;
            font-size: 9.5px;
            font-weight: 800;
            font-family: monospace, monospace;
            color: #ffffff;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
            pointer-events: none;
        }

        /* Attack Action Button */
        .stakeout-attack-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: #166534;
            border: 1px solid #22c55e;
            color: #ffffff !important;
            padding: 6px;
            border-radius: 5px;
            font-size: 12px;
            font-weight: 800;
            text-decoration: none !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
            transition: all 0.15s ease;
        }
        .stakeout-attack-btn:hover {
            background: #15803d;
            box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
        }
        .stakeout-attack-btn.ready {
            background: #16a34a;
            animation: stakeoutPillPulse 1.2s infinite ease-in-out;
        }

        /* Settings Drawer */
        .stakeout-settings {
            background: #0f172a;
            border-top: 1px solid #334155;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 12px;
            color: #cbd5e1;
        }
        .stakeout-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
        }
        .stakeout-toggle-row input {
            cursor: pointer;
            width: 16px;
            height: 16px;
        }

        /* Profile Page Quick Stakeout Button */
        .stakeout-profile-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            background: #1e293b !important;
            border: 1px solid #3b82f6 !important;
            color: #60a5fa !important;
            padding: 4px 10px !important;
            border-radius: 4px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            margin: 4px 2px !important;
            transition: all 0.15s ease !important;
        }
        .stakeout-profile-btn:hover {
            background: #2563eb !important;
            color: #ffffff !important;
            border-color: #60a5fa !important;
        }
        .stakeout-profile-btn.active {
            background: #166534 !important;
            border-color: #22c55e !important;
            color: #86efac !important;
        }
    `);

    // --- 8. UI BUILDER & DOCK ---
    let dockRoot = null;

    function renderRadarUI() {
        if (!dockRoot) {
            dockRoot = document.createElement('div');
            dockRoot.id = 'torn-mercenary-dock';
            document.body.appendChild(dockRoot);
        }

        const readyCount = watchlist.filter(id => {
            const t = targetsCache[id]?.data;
            return t && t.state === 'Okay';
        }).length;

        if (config.isMinimized) {
            dockRoot.innerHTML = `
                <div class="stakeout-pill ${readyCount > 0 ? 'has-ready' : ''}" id="stakeout-pill-toggle">
                    <span class="stakeout-radar-icon">🎯</span>
                    <span>Radar (${watchlist.length})${readyCount > 0 ? ` • ⚡ ${readyCount} READY` : ''}</span>
                </div>
            `;
            document.getElementById('stakeout-pill-toggle').onclick = () => {
                config.isMinimized = false;
                saveConfig();
                renderRadarUI();
            };
            return;
        }

        const callRate = getApiCallRate();
        dockRoot.innerHTML = `
            <div class="stakeout-window">
                <div class="stakeout-header">
                    <div class="stakeout-title">
                        <span class="stakeout-radar-icon">🎯</span>
                        <span>Stakeout Radar</span>
                        <span style="font-size: 10px; color: ${config.isPaused ? '#f59e0b' : '#22c55e'}; font-weight: 600;">
                            ${config.isPaused ? '⏸ PAUSED' : '● SCANNING'}
                        </span>
                    </div>
                    <div class="stakeout-header-actions">
                        <button class="stakeout-btn-icon" id="stakeout-btn-pause" title="${config.isPaused ? 'Resume Scanning' : 'Pause Scanning'}">
                            ${config.isPaused ? '▶' : '⏸'}
                        </button>
                        <button class="stakeout-btn-icon" id="stakeout-btn-settings" title="Toggle Trigger Settings">⚙</button>
                        <button class="stakeout-btn-icon" id="stakeout-btn-minimize" title="Minimize Radar">−</button>
                    </div>
                </div>

                <div class="stakeout-add-bar">
                    <input type="text" class="stakeout-input" id="stakeout-input-target" placeholder="Enter Player ID or Profile URL..." />
                    <button class="stakeout-btn-primary" id="stakeout-btn-add">+ Add</button>
                </div>

                <div id="stakeout-settings-panel" class="stakeout-settings" style="display: none;">
                    <div style="font-weight: 800; color: #f8fafc; margin-bottom: 2px;">⚡ Stakeout Trigger Toggles:</div>
                    <label class="stakeout-toggle-row">
                        <span>Alert on Target Okay (Hospital Discharge)</span>
                        <input type="checkbox" id="toggle-alert-okay" ${config.alertOnOkay ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Alert on Target Online / Active</span>
                        <input type="checkbox" id="toggle-alert-online" ${config.alertOnOnline ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Alert on Target Flight Landing</span>
                        <input type="checkbox" id="toggle-alert-landing" ${config.alertOnLanding ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Alert on Full 100% HP</span>
                        <input type="checkbox" id="toggle-alert-fullhp" ${config.alertOnFullHp ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Audio Sound Alarm (Chime/Horn)</span>
                        <input type="checkbox" id="toggle-sound-alarm" ${config.soundAlarm ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Desktop Notification</span>
                        <input type="checkbox" id="toggle-desktop-notif" ${config.desktopNotif ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>Auto-Open Attack Tab when Okay</span>
                        <input type="checkbox" id="toggle-auto-attack" ${config.autoOpenAttack ? 'checked' : ''} />
                    </label>
                    <div style="display: flex; gap: 6px; margin-top: 4px;">
                        <button class="stakeout-btn-icon" id="stakeout-btn-test-sound" style="flex: 1; padding: 5px;">🔊 Test Alarm Sound</button>
                    </div>
                    <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">
                        Rate Limit: ${callRate}/90 calls/min • Polling: Every ${config.pollingInterval}s
                    </div>
                </div>

                <div class="stakeout-list" id="stakeout-target-list">
                    ${watchlist.length === 0 ? '<div class="stakeout-empty">No targets on watchlist.<br>Add an ID above or click "🎯 Stakeout" on any profile!</div>' : ''}
                </div>
            </div>
        `;

        // Bind Window Actions
        document.getElementById('stakeout-btn-minimize').onclick = () => {
            config.isMinimized = true;
            saveConfig();
            renderRadarUI();
        };

        document.getElementById('stakeout-btn-pause').onclick = () => {
            config.isPaused = !config.isPaused;
            saveConfig();
            renderRadarUI();
        };

        const settingsPanel = document.getElementById('stakeout-settings-panel');
        document.getElementById('stakeout-btn-settings').onclick = () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
        };

        // Bind Settings Toggles
        document.getElementById('toggle-alert-okay').onchange = (e) => { config.alertOnOkay = e.target.checked; saveConfig(); };
        document.getElementById('toggle-alert-online').onchange = (e) => { config.alertOnOnline = e.target.checked; saveConfig(); };
        document.getElementById('toggle-alert-landing').onchange = (e) => { config.alertOnLanding = e.target.checked; saveConfig(); };
        document.getElementById('toggle-alert-fullhp').onchange = (e) => { config.alertOnFullHp = e.target.checked; saveConfig(); };
        document.getElementById('toggle-sound-alarm').onchange = (e) => { config.soundAlarm = e.target.checked; saveConfig(); };
        document.getElementById('toggle-desktop-notif').onchange = (e) => {
            config.desktopNotif = e.target.checked;
            saveConfig();
            if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
                Notification.requestPermission();
            }
        };
        document.getElementById('toggle-auto-attack').onchange = (e) => { config.autoOpenAttack = e.target.checked; saveConfig(); };
        document.getElementById('stakeout-btn-test-sound').onclick = () => playStakeoutAlarm('okay');

        // Bind Add Target
        const inputEl = document.getElementById('stakeout-input-target');
        const handleAdd = () => {
            const raw = inputEl.value.trim();
            if (!raw) return;
            const match = raw.match(/XID=(\d+)/) || raw.match(/user2ID=(\d+)/) || raw.match(/^(\d+)$/);
            if (match) {
                const targetId = match[1];
                if (!watchlist.includes(targetId)) {
                    watchlist.push(targetId);
                    saveWatchlist();
                    inputEl.value = '';
                    renderRadarUI();
                    pollSingleTarget(targetId);
                } else {
                    alert(`Player [${targetId}] is already on the stakeout watchlist.`);
                }
            } else {
                alert('Please enter a valid Torn Player ID or Profile URL.');
            }
        };
        document.getElementById('stakeout-btn-add').onclick = handleAdd;
        inputEl.onkeydown = (e) => { if (e.key === 'Enter') handleAdd(); };

        // Render Cards
        const listContainer = document.getElementById('stakeout-target-list');
        watchlist.forEach(id => {
            const card = document.createElement('div');
            card.id = `stakeout-card-${id}`;
            card.className = 'stakeout-card';
            listContainer.appendChild(card);
            updateTargetCardUI(id);
        });
    }

    function updateRadarBadge() {
        if (!config.isMinimized) return;
        renderRadarUI();
    }

    function formatCountdown(sec) {
        if (sec <= 0) return '00:00';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function updateTargetCardUI(targetId) {
        const card = document.getElementById(`stakeout-card-${targetId}`);
        if (!card) return;

        const info = targetsCache[targetId];
        if (!info || !info.data) {
            card.innerHTML = `
                <div class="stakeout-card-header">
                    <span class="stakeout-card-name">🎯 Target [${targetId}]</span>
                    <button class="stakeout-btn-icon" data-del="${targetId}">✕</button>
                </div>
                <div style="font-size: 11px; color: #94a3b8;">Scanning telemetry...</div>
            `;
            const delBtn = card.querySelector(`[data-del="${targetId}"]`);
            if (delBtn) delBtn.onclick = () => removeTarget(targetId);
            return;
        }

        const d = info.data;
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = d.until > nowSec ? d.until - nowSec : 0;
        const isOkay = d.state === 'Okay';

        card.className = `stakeout-card ${isOkay ? 'ready' : ''}`;

        let statusBadge = '';
        if (d.state === 'Hospital') {
            statusBadge = `<span class="stakeout-status-pill hospital">🏥 Hosp: ${formatCountdown(remainingSec)}</span>`;
        } else if (d.state === 'Traveling') {
            statusBadge = `<span class="stakeout-status-pill traveling">✈️ ${d.desc || 'Traveling'} (${formatCountdown(remainingSec)})</span>`;
        } else if (d.state === 'Abroad') {
            statusBadge = `<span class="stakeout-status-pill abroad">🌍 ${d.desc || 'Abroad'}</span>`;
        } else if (d.state === 'Jail') {
            statusBadge = `<span class="stakeout-status-pill hospital">🚔 Jail: ${formatCountdown(remainingSec)}</span>`;
        } else {
            statusBadge = `<span class="stakeout-status-pill okay">✅ OKAY — READY!</span>`;
        }

        const dotClass = d.online === 'Online' ? 'online' : (d.online === 'Idle' ? 'idle' : 'offline');

        let hpBarFillClass = '';
        if (d.hpPct < 25) hpBarFillClass = 'danger';
        else if (d.hpPct < 50) hpBarFillClass = 'warning';

        card.innerHTML = `
            <div class="stakeout-card-header">
                <a href="https://www.torn.com/profiles.php?XID=${targetId}" target="_blank" class="stakeout-card-name" title="View Profile">
                    <span class="stakeout-dot ${dotClass}" title="Status: ${d.online}"></span>
                    <span>${d.name} [${targetId}]</span>
                    ${d.level > 0 ? `<span style="font-size: 10px; color: #94a3b8;">(Lvl ${d.level})</span>` : ''}
                </a>
                <button class="stakeout-btn-icon" data-del="${targetId}" title="Remove Target">✕</button>
            </div>

            <div class="stakeout-card-badges">
                ${statusBadge}
                <span style="color: #cbd5e1;">${d.lastActionRel || d.online}</span>
            </div>

            <div class="stakeout-hp-bar-wrap" title="HP: ${d.hpCurr.toLocaleString()} / ${d.hpMax.toLocaleString()} (${d.hpPct.toFixed(1)}%)">
                <div class="stakeout-hp-bar-fill ${hpBarFillClass}" style="width: ${d.hpPct}%;"></div>
                <div class="stakeout-hp-text">❤️ ${d.hpCurr.toLocaleString()} / ${d.hpMax.toLocaleString()} (${d.hpPct.toFixed(d.hpPct % 1 === 0 ? 0 : 1)}%)</div>
            </div>

            <a href="https://www.torn.com/page.php?sid=attack&user2ID=${targetId}" target="_blank" class="stakeout-attack-btn ${isOkay ? 'ready' : ''}">
                <span>⚔️ ATTACK TARGET</span>
                ${isOkay ? '<span>⚡ (READY!)</span>' : ''}
            </a>
        `;

        const delBtn = card.querySelector(`[data-del="${targetId}"]`);
        if (delBtn) delBtn.onclick = () => removeTarget(targetId);
    }

    function removeTarget(targetId) {
        watchlist = watchlist.filter(id => id !== targetId);
        delete targetsCache[targetId];
        saveWatchlist();
        renderRadarUI();
        updateProfilePageButton();
    }

    // --- 9. PROFILE PAGE QUICK STAKEOUT BUTTON ---
    function updateProfilePageButton() {
        if (!window.location.href.includes('profiles.php')) return;
        const match = window.location.href.match(/XID=(\d+)/);
        if (!match) return;
        const profileId = match[1];

        let btn = document.getElementById('stakeout-profile-action-btn');
        const isWatched = watchlist.includes(profileId);

        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'stakeout-profile-action-btn';
            btn.className = 'stakeout-profile-btn';

            const targetContainer = document.querySelector('.profile-container .basic-information, .profile-right-wrapper, .profile-wrapper h4, .user-information');
            if (targetContainer) {
                targetContainer.prepend(btn);
            }
        }

        if (btn) {
            btn.className = `stakeout-profile-btn ${isWatched ? 'active' : ''}`;
            btn.innerHTML = isWatched ? `🎯 In Stakeout Radar (Click to Remove)` : `🎯 Add to Stakeout Radar`;
            btn.onclick = (e) => {
                e.preventDefault();
                if (isWatched) {
                    removeTarget(profileId);
                } else {
                    watchlist.push(profileId);
                    saveWatchlist();
                    renderRadarUI();
                    pollSingleTarget(profileId);
                    updateProfilePageButton();
                }
            };
        }
    }

    // --- 10. POLLING SCHEDULER & RUNTIME ---
    let pollIndex = 0;
    async function pollSingleTarget(targetId) {
        const fresh = await fetchTargetTelemetry(targetId);
        if (fresh) evaluateTargetTriggers(targetId, fresh);
    }

    async function pollNextWatchlistTarget() {
        if (config.isPaused || watchlist.length === 0) return;

        // Check if any target has hospital timer < 60s for rapid poll
        let rapidTargetId = null;
        if (config.rapidHospPolling) {
            const nowSec = Math.floor(Date.now() / 1000);
            for (const id of watchlist) {
                const info = targetsCache[id]?.data;
                if (info && info.state === 'Hospital' && info.until > nowSec && (info.until - nowSec) <= 60) {
                    rapidTargetId = id;
                    break;
                }
            }
        }

        const targetToPoll = rapidTargetId || watchlist[pollIndex % watchlist.length];
        pollIndex = (pollIndex + 1) % watchlist.length;

        await pollSingleTarget(targetToPoll);
    }

    // Main lifecycle ticker
    setInterval(pollNextWatchlistTarget, (config.pollingInterval || 5) * 1000);

    // Live 1-second countdown clock for hospital/flight badges
    setInterval(() => {
        if (config.isMinimized || watchlist.length === 0) return;
        watchlist.forEach(id => updateTargetCardUI(id));
    }, 1000);

    // Initial boot
    renderRadarUI();
    updateProfilePageButton();

    // Re-check profile page on AJAX/history navigation
    window.addEventListener('popstate', updateProfilePageButton);
    const observer = new MutationObserver(() => {
        updateProfilePageButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial fetch for all targets on load
    if (watchlist.length > 0) {
        watchlist.forEach((id, idx) => {
            setTimeout(() => pollSingleTarget(id), idx * 1500);
        });
    }
})();
