// ==UserScript==
// @name         TornPDA - Mercenary Stakeout Radar
// @namespace    Violentmonkey Scripts
// @version      1.00
// @description  Torn PDA mobile-optimized stakeout radar: live multi-target tracking for hospital discharge, online activity, flight landings, and instant alarms with 1-tap attack staging.
// @author       Merogie & Antigravity
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_notification
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_stakeout_radar.user.js
// @updateURL    https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_stakeout_radar.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // Guard against multiple injection on dynamic page reloads (per Torn PDA guidelines)
    if (window.__TORNPDA_STAKEOUT_RADAR_ACTIVE__) {
        if (typeof window.__TORNPDA_STAKEOUT_RADAR_RECHECK__ === 'function') {
            window.__TORNPDA_STAKEOUT_RADAR_RECHECK__();
        }
        return;
    }
    window.__TORNPDA_STAKEOUT_RADAR_ACTIVE__ = true;

    const SCRIPT_VERSION = "1.00";
    const SCRIPT_RAW_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_stakeout_radar.user.js";
    const SCRIPT_META_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_stakeout_radar.meta.js";

    // Native Torn PDA runtime-injected key macro
    const PDA_INJECTED_KEY = "###PDA-APIKEY###";

    // Safe style injector with fallback for WebViews without GM_addStyle
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

    // --- 1. TOAST NOTIFICATION & UPDATE ENGINE ---
    function showStakeoutToast(message) {
        try {
            const existing = document.getElementById('tornpda-stakeout-toast');
            if (existing) existing.remove();

            const toast = document.createElement('div');
            toast.id = 'tornpda-stakeout-toast';
            toast.className = (typeof config === 'object' && config.dockPosition === 'right') ? 'position-right' : 'position-left';
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 400);
            }, 3500);
        } catch (e) {
            console.log('[StakeoutPDA Toast]', message);
        }
    }

    function compareVersions(v1, v2) {
        const p1 = String(v1).split('.').map(n => parseInt(n, 10) || 0);
        const p2 = String(v2).split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(p1.length, p2.length);
        for (let i = 0; i < len; i++) {
            const a = p1[i] || 0;
            const b = p2[i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    }

    function checkForScriptUpdates(manual = false) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            if (manual) showStakeoutToast('⚠️ GM_xmlhttpRequest not available in this environment.');
            return;
        }

        if (manual) showStakeoutToast('🔄 Checking for Torn PDA Radar updates...');

        GM_xmlhttpRequest({
            method: 'GET',
            url: `${SCRIPT_META_URL}?t=${Date.now()}`,
            headers: { 'Cache-Control': 'no-cache' },
            onload: function (response) {
                if (response.status === 200) {
                    const match = response.responseText.match(/@version\s+([\d.]+)/);
                    if (match && match[1]) {
                        const remoteVersion = match[1];
                        if (compareVersions(remoteVersion, SCRIPT_VERSION) > 0) {
                            showUpdateBanner(remoteVersion);
                        } else if (manual) {
                            showStakeoutToast(`✓ Radar is up to date (v${SCRIPT_VERSION}).`);
                        }
                    } else if (manual) {
                        showStakeoutToast('⚠️ Could not parse remote version header.');
                    }
                } else if (manual) {
                    showStakeoutToast(`⚠️ Update check failed (HTTP ${response.status}).`);
                }
            },
            onerror: function () {
                if (manual) showStakeoutToast('⚠️ Network error checking for updates.');
            }
        });
    }

    function showUpdateBanner(remoteVersion) {
        const existing = document.getElementById('tornpda-stakeout-update-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'tornpda-stakeout-update-banner';
        banner.innerHTML = `
            <span>🚀 Radar v${remoteVersion} available!</span>
            <div style="display: flex; gap: 6px;">
                <button id="tornpda-stakeout-btn-install-update" style="background: #22c55e; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; font-weight: 700; font-size: 11px; cursor: pointer;">Install</button>
                <button id="tornpda-stakeout-btn-dismiss-update" style="background: transparent; color: #94a3b8; border: 1px solid #475569; border-radius: 4px; padding: 4px 6px; font-size: 11px; cursor: pointer;">✕</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('tornpda-stakeout-btn-install-update').onclick = () => {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(SCRIPT_RAW_URL, { active: true });
            } else {
                window.open(SCRIPT_RAW_URL, '_blank');
            }
            banner.remove();
        };

        document.getElementById('tornpda-stakeout-btn-dismiss-update').onclick = () => {
            banner.remove();
        };
    }

    // Auto-check updates once every 24 hours
    function autoCheckForUpdates() {
        try {
            const now = Date.now();
            const lastCheck = getStorage('last_update_check_time', 0);
            if (now - lastCheck > 24 * 60 * 60 * 1000) {
                setStorage('last_update_check_time', now);
                checkForScriptUpdates(false);
            }
        } catch (e) {}
    }

    // --- 2. CONFIGURATION & STATE STORAGE ---
    function getStorage(key, defaultValue) {
        try {
            if (typeof GM_getValue === 'function') {
                const gmVal = GM_getValue(key, undefined);
                if (gmVal !== undefined) return gmVal;
            }
            const local = localStorage.getItem(`tornpda_stakeout_${key}`);
            if (local !== null) return JSON.parse(local);
        } catch (e) {}
        return defaultValue;
    }

    function setStorage(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
            }
            localStorage.setItem(`tornpda_stakeout_${key}`, JSON.stringify(value));
        } catch (e) {}
    }

    // Comprehensive API Key Resolution for Torn PDA:
    // Priority 1: Native Torn PDA injected runtime macro ###PDA-APIKEY###
    // Priority 2: Account-specific storage
    // Priority 3: Global storage
    // Priority 4: Existing keys in localStorage (Torn PDA War Sorter, FF Scouter, etc.)
    function getApiKey() {
        if (typeof PDA_INJECTED_KEY === 'string' &&
            PDA_INJECTED_KEY.length === 16 &&
            !PDA_INJECTED_KEY.includes('###') &&
            /^[a-zA-Z0-9]+$/.test(PDA_INJECTED_KEY)) {
            return PDA_INJECTED_KEY;
        }

        const uid = getLoggedInUserId();
        if (uid) {
            const accStakeout = getStorage(`api_key_${uid}`, null);
            if (accStakeout && accStakeout.length === 16) return accStakeout;

            const accLimited = getStorage(`limited_key_${uid}`, null);
            if (accLimited && accLimited.length === 16) return accLimited;

            const localAccKey = localStorage.getItem(`limited_key_${uid}`) || localStorage.getItem(`ff_twse_limited_key_${uid}`);
            if (localAccKey && localAccKey.length === 16) return localAccKey;
        }

        const globalStakeout = getStorage('api_key', null);
        if (globalStakeout && globalStakeout.length === 16) return globalStakeout;

        const candidates = [
            getStorage('limited_key', null),
            localStorage.getItem('twse-config-apikey'),
            localStorage.getItem('limited_key'),
            localStorage.getItem('torn_api_key'),
            localStorage.getItem('tornpda_api_key')
        ];
        for (const c of candidates) {
            if (c && typeof c === 'string' && c.length === 16) return c;
        }

        return null;
    }

    function getApiKeyDetails() {
        const key = getApiKey();
        const uid = getLoggedInUserId();
        let source = 'None';
        if (typeof PDA_INJECTED_KEY === 'string' && PDA_INJECTED_KEY.length === 16 && !PDA_INJECTED_KEY.includes('###')) {
            source = 'Torn PDA Injected Macro';
        } else if (key) {
            source = 'Saved Storage';
        }
        return { key, source, uid };
    }

    function maskApiKey(key) {
        if (!key || key.length < 8) return 'None';
        return key.substring(0, 3) + '••••••••' + key.substring(key.length - 3);
    }

    function getLoggedInUserId() {
        try {
            const userIcon = document.querySelector('a[href*="/profiles.php?XID="]');
            if (userIcon) {
                const match = userIcon.getAttribute('href').match(/XID=(\d+)/);
                if (match) return match[1];
            }
            const scriptMatch = document.documentElement.innerHTML.match(/["']userID["']:\s*["']?(\d+)["']?/);
            if (scriptMatch) return scriptMatch[1];
        } catch (e) {}
        return null;
    }

    function promptSetApiKey() {
        const currentKey = getApiKey() || '';
        const input = prompt('Enter your 16-character Torn API Key (Minimal, Limited, or Full Access):', currentKey);
        if (input !== null) {
            const trimmed = input.trim();
            if (trimmed.length === 16 && /^[a-zA-Z0-9]+$/.test(trimmed)) {
                const uid = getLoggedInUserId();
                if (uid) setStorage(`api_key_${uid}`, trimmed);
                setStorage('api_key', trimmed);
                showStakeoutToast('✓ API Key saved successfully.');
                renderRadarUI();
                watchlist.forEach(id => pollSingleTarget(id));
            } else if (trimmed === '') {
                const uid = getLoggedInUserId();
                if (uid) setStorage(`api_key_${uid}`, null);
                setStorage('api_key', null);
                showStakeoutToast('API Key removed.');
                renderRadarUI();
            } else {
                alert('Invalid API key format. Must be exactly 16 alphanumeric characters.');
            }
        }
    }

    const DEFAULT_CONFIG = {
        alertOnOkay: true,          // ⚔️ Alert when target satisfies BOTH criteria (Out & Alive + Online/Action <= limitMin)
        requireActive: true,        // ⚡ Strict 2-Condition Rule Enforced
        activeThresholdMin: 5,      // 5 minutes
        alertOnLanding: true,       // Alert on flight arrival (only if Out & Alive + Active)
        alertOnFullHp: false,       // Alert on 100% HP (only if Out & Alive + Active)
        alertOnFullEnergy: true,    // 🔔 Separate bell chime when your energy reaches 100% while waiting for hospital targets
        alertOnDrugCooldown: true,  // 💊 Little bell chime when drug cooldown reaches 0:00 (Ready to take next drug)
        attackDestination: 'attack', // 'attack' (Direct sid=attack) | 'profile' (User Profile for double confirm)
        soundAlarm: true,
        alarmVolume: 1.0,           // 0.1 to 1.0 (10% to 100%)
        alarmSoundType: 'siren',    // 'siren' (loudest) | 'horn' | 'klaxon' | 'chime'
        vibrateAlarm: true,         // 📳 Mobile Haptic Vibration feedback on alerts & long-press
        desktopNotif: true,
        rapidHospPolling: true,     // Dynamically increase to 1s polling when target hospital discharge <= 1 min (otherwise 5s)
        pollingInterval: 5,         // seconds
        isPaused: false,
        isMinimized: false,
        dockPosition: 'left'        // 'left' (default) | 'right'
    };

    let config = Object.assign({}, DEFAULT_CONFIG, getStorage('config', {}));
    delete config.autoOpenAttack;
    delete config.alertOnNearHosp;
    delete config.nearHospThresholdMin;
    config.requireActive = true; // Permanently enforced per 2-Condition rule

    function saveConfig() {
        setStorage('config', config);
    }

    let watchlist = getStorage('watchlist', []);
    if (!Array.isArray(watchlist)) watchlist = [];
    function saveWatchlist() {
        setStorage('watchlist', watchlist);
    }

    let targetMeta = getStorage('target_meta', {});
    if (typeof targetMeta !== 'object' || targetMeta === null) targetMeta = {};
    function saveTargetMeta() {
        setStorage('target_meta', targetMeta);
    }

    function isTargetStricken(targetId) {
        return !!targetMeta[targetId]?.isStricken;
    }

    function setTargetStricken(targetId, isStricken) {
        if (!targetMeta[targetId]) targetMeta[targetId] = {};
        targetMeta[targetId].isStricken = !!isStricken;
        saveTargetMeta();
    }

    function getTargetInactiveLimit(targetId) {
        const val = targetMeta[targetId]?.inactiveLimitMin;
        if (typeof val === 'number' && val > 0) return val;
        return config.activeThresholdMin || 5;
    }

    function setTargetInactiveLimit(targetId, limitMin) {
        if (!targetMeta[targetId]) targetMeta[targetId] = {};
        targetMeta[targetId].inactiveLimitMin = parseInt(limitMin, 10) || 5;
        saveTargetMeta();
    }

    // In-memory runtime cache for target snapshots
    const targetsCache = {};
    let pollIndex = 0;
    let isPolling = false;
    let backgroundTicker = null;
    let currentPollingIntervalMs = (config.pollingInterval || 5) * 1000;
    let dockRoot = null;

    // Energy state trackers
    let lastEnergyAlertState = false;
    let lastEnergyAlertTime = 0;

    // --- 3. AUDIO SYNTHESIS & MOBILE HAPTIC ENGINE ---
    let audioContext = null;

    // Mobile Web Audio unlock listener (touch events on mobile resume suspended AudioContext)
    const unlockEvents = ['touchstart', 'touchend', 'click', 'keydown'];
    function unlockAudioEngine() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx && !audioContext) {
                audioContext = new AudioCtx();
            }
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
        } catch (e) {}
        unlockEvents.forEach(evt => window.removeEventListener(evt, unlockAudioEngine, { capture: true }));
    }
    unlockEvents.forEach(evt => window.addEventListener(evt, unlockAudioEngine, { capture: true, passive: true }));

    function playPcmWavFallback(freq = 880, durationMs = 800, volume = 1.0) {
        try {
            const sampleRate = 8000;
            const numSamples = Math.floor(sampleRate * (durationMs / 1000));
            const buffer = new Uint8Array(44 + numSamples);

            function writeString(offset, str) {
                for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i);
            }
            function writeUint32(offset, val) {
                buffer[offset] = val & 0xff;
                buffer[offset + 1] = (val >> 8) & 0xff;
                buffer[offset + 2] = (val >> 16) & 0xff;
                buffer[offset + 3] = (val >> 24) & 0xff;
            }
            function writeUint16(offset, val) {
                buffer[offset] = val & 0xff;
                buffer[offset + 1] = (val >> 8) & 0xff;
            }

            writeString(0, 'RIFF');
            writeUint32(4, 36 + numSamples);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            writeUint32(16, 16);
            writeUint16(20, 1);
            writeUint16(22, 1);
            writeUint32(24, sampleRate);
            writeUint32(28, sampleRate);
            writeUint16(32, 1);
            writeUint16(34, 8);
            writeString(36, 'data');
            writeUint32(40, numSamples);

            const volScale = Math.min(1.0, Math.max(0.1, volume));
            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate;
                const sample = Math.sin(2 * Math.PI * freq * t);
                buffer[44 + i] = Math.floor(128 + 127 * sample * volScale);
            }

            let binary = '';
            const len = buffer.byteLength;
            for (let i = 0; i < len; i++) binary += String.fromCharCode(buffer[i]);
            const base64 = btoa(binary);
            const audio = new Audio(`data:audio/wav;base64,${base64}`);
            audio.volume = volScale;
            audio.play().catch(e => console.warn('[StakeoutPDA] Audio play failed:', e));
        } catch (e) {
            console.error('[StakeoutPDA] PCM Fallback error:', e);
        }
    }

    function triggerHaptic(type = 'alarm') {
        if (!config.vibrateAlarm || typeof navigator.vibrate !== 'function') return;
        try {
            if (type === 'alarm') {
                // Urgent pulsating pattern: 250ms buzz, 100ms pause, 250ms buzz, 100ms pause, 500ms buzz
                navigator.vibrate([250, 100, 250, 100, 500]);
            } else if (type === 'bell') {
                // Gentle chime pattern: 100ms buzz, 80ms pause, 180ms buzz
                navigator.vibrate([100, 80, 180]);
            } else if (type === 'tap') {
                // Crisp click feedback: 40ms buzz
                navigator.vibrate(40);
            }
        } catch (e) {}
    }

    function playStakeoutAlarm(type = 'okay') {
        if (!config.soundAlarm && type !== 'test') {
            if (type === 'okay') triggerHaptic('alarm');
            else if (type === 'bell') triggerHaptic('bell');
            return;
        }

        const vol = Math.max(0.1, Math.min(1.0, config.alarmVolume ?? 1.0));

        if (type === 'okay' || type === 'test') {
            triggerHaptic('alarm');
        } else if (type === 'bell') {
            triggerHaptic('bell');
        }

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) throw new Error('Web Audio not supported');

            if (!audioContext) audioContext = new AudioCtx();
            if (audioContext.state === 'suspended') audioContext.resume();

            const ctx = audioContext;
            const chosenType = (type === 'test' || type === 'okay') ? (config.alarmSoundType || 'siren') : type;

            if (chosenType === 'siren') {
                // High-Pitch Emergency War Siren (2-Cycle Sweep: 650Hz -> 1350Hz, 1.2s total)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.9 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                for (let i = 0; i < 2; i++) {
                    const t0 = ctx.currentTime + (i * 0.6);
                    const osc = ctx.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(650, t0);
                    osc.frequency.linearRampToValueAtTime(1350, t0 + 0.3);
                    osc.frequency.linearRampToValueAtTime(650, t0 + 0.58);

                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.7, t0);
                    g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.58);

                    osc.connect(g);
                    g.connect(masterGain);
                    osc.start(t0);
                    osc.stop(t0 + 0.58);
                }
            } else if (chosenType === 'horn') {
                // Tactical Air Horn (Dual Sawtooth: 311Hz & 466Hz, punchy 0.9s duration)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.95 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                const t0 = ctx.currentTime;
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                osc1.type = 'sawtooth';
                osc2.type = 'sawtooth';
                osc1.frequency.setValueAtTime(311.13, t0); // Eb4
                osc2.frequency.setValueAtTime(466.16, t0); // Bb4

                const g = ctx.createGain();
                g.gain.setValueAtTime(0.8, t0);
                g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.9);

                osc1.connect(g);
                osc2.connect(g);
                g.connect(masterGain);
                osc1.start(t0);
                osc2.start(t0);
                osc1.stop(t0 + 0.9);
                osc2.stop(t0 + 0.9);
            } else if (chosenType === 'klaxon') {
                // Heavy Klaxon (Dual Tone: 440Hz -> 330Hz repeat, 1.0s)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.9 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                for (let i = 0; i < 2; i++) {
                    const t0 = ctx.currentTime + (i * 0.45);
                    const osc = ctx.createOscillator();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(440, t0);
                    osc.frequency.setValueAtTime(330, t0 + 0.2);

                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.6, t0);
                    g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.42);

                    osc.connect(g);
                    g.connect(masterGain);
                    osc.start(t0);
                    osc.stop(t0 + 0.42);
                }
            } else if (chosenType === 'chime') {
                // Bright Multi-Chime (3 Rapid Strikes: C6 & E6, 0.9s total)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.85 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                for (let i = 0; i < 3; i++) {
                    const t0 = ctx.currentTime + (i * 0.3);
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc1.type = 'sawtooth';
                    osc2.type = 'square';
                    osc1.frequency.setValueAtTime(1046.5, t0); // C6
                    osc2.frequency.setValueAtTime(1318.5, t0); // E6
                    g.gain.setValueAtTime(0.6, t0);
                    g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.22);
                    osc1.connect(g);
                    osc2.connect(g);
                    g.connect(masterGain);
                    osc1.start(t0);
                    osc2.start(t0);
                    osc1.stop(t0 + 0.22);
                    osc2.stop(t0 + 0.22);
                }
            } else if (type === 'bell') {
                // Golden Bell Chime (Energy Full Notification): 2-strike melodic bell chime (1318.5Hz [E6] -> 1046.5Hz [C6])
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.85 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                const bellStrikes = [
                    { f: 1318.51, start: 0, dur: 1.2 },    // High Ding (E6)
                    { f: 1046.50, start: 0.22, dur: 1.5 }  // Resonant Dong (C6)
                ];

                bellStrikes.forEach(b => {
                    const t0 = ctx.currentTime + b.start;
                    const oscFund = ctx.createOscillator();
                    const oscHarm = ctx.createOscillator();
                    const g = ctx.createGain();

                    oscFund.type = 'sine';
                    oscHarm.type = 'triangle';
                    oscFund.frequency.setValueAtTime(b.f, t0);
                    oscHarm.frequency.setValueAtTime(b.f * 2.02, t0);

                    g.gain.setValueAtTime(0.0001, t0);
                    g.gain.linearRampToValueAtTime(0.7, t0 + 0.008);
                    g.gain.exponentialRampToValueAtTime(0.0001, t0 + b.dur);

                    oscFund.connect(g);
                    oscHarm.connect(g);
                    g.connect(masterGain);

                    oscFund.start(t0);
                    oscHarm.start(t0);
                    oscFund.stop(t0 + b.dur);
                    oscHarm.stop(t0 + b.dur);
                });
            }
        } catch (e) {
            console.error('[StakeoutPDA] Audio error, falling back to PCM WAV:', e);
            playPcmWavFallback(type === 'bell' ? 1318 : 880, 800, vol);
        }
    }

    // --- 4. DESKTOP / IN-APP NOTIFICATIONS ---
    function sendStakeoutNotification(title, body) {
        if (!config.desktopNotif) return;
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    title: `🎯 Stakeout: ${title}`,
                    text: body,
                    image: 'https://www.torn.com/favicon.ico',
                    highlight: true,
                    timeout: 15000,
                    onclick: () => {
                        window.focus();
                    }
                });
            } else if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(`🎯 Stakeout: ${title}`, {
                    body: body,
                    icon: 'https://www.torn.com/favicon.ico'
                });
            }
        } catch (e) {}
    }

    // --- 4.1 ENERGY TELEMETRY & FULL ENERGY BELL ---
    function normalizeEnergy(rawCurr, rawMax) {
        let c = parseInt(String(rawCurr).replace(/,/g, ''), 10);
        let m = parseInt(String(rawMax).replace(/,/g, ''), 10);
        if (isNaN(c) || isNaN(m)) return null;

        // Fix Torn SVG coordinate / percentage scaling (e.g. 15000 or 10000)
        if (m > 500 && m % 100 === 0) {
            m = m / 100;
            if (c > 500 && c % 100 === 0) c = c / 100;
        } else if (m > 500) {
            m = Math.round(m / 100);
            if (c > 500) c = Math.round(c / 100);
        }

        if (m <= 0) return null;
        return { current: c, maximum: m };
    }

    function getPlayerEnergyFromDom() {
        try {
            const sidebar = document.getElementById('sidebarroot') || document.body;
            const energySelectors = [
                '#sidebarroot [class*="energy"]',
                '[class*="energy___"]',
                '[class*="bar-energy"]',
                '[class*="barEnergy"]',
                '#barEnergy',
                '[data-bar="energy"]',
                '[aria-label*="Energy" i]'
            ];

            // Priority 1 (Ground Truth): Visible text in energy elements (e.g. "Energy: 135/150 00:21")
            for (const sel of energySelectors) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const text = el.textContent || '';
                    const m = text.match(/(?:Energy:?\s*)?(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i);
                    if (m) {
                        const norm = normalizeEnergy(m[1], m[2]);
                        if (norm) return norm;
                    }
                }
            }

            // Priority 2: Direct scan of entire #sidebarroot text
            const sidebarText = sidebar.innerText || sidebar.textContent || '';
            const sm = sidebarText.match(/Energy:?\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i);
            if (sm) {
                const norm = normalizeEnergy(sm[1], sm[2]);
                if (norm) return norm;
            }

            // Priority 3: Aria attributes with normalization (guarantees 15000 -> 150)
            for (const sel of energySelectors) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const ariaNow = el.getAttribute('aria-valuenow');
                    const ariaMax = el.getAttribute('aria-valuemax');
                    if (ariaNow !== null && ariaMax !== null) {
                        const norm = normalizeEnergy(ariaNow, ariaMax);
                        if (norm) return norm;
                    }
                }
            }

            // Priority 4: Global body text scan fallback
            if (document.body && document.body !== sidebar) {
                const bodyText = document.body.innerText || '';
                const bm = bodyText.match(/Energy:?\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i);
                if (bm) {
                    const norm = normalizeEnergy(bm[1], bm[2]);
                    if (norm) return norm;
                }
            }
        } catch (e) {
            console.warn('[StakeoutPDA] getPlayerEnergyFromDom error:', e);
        }
        return null;
    }

    function checkEnergyStatus() {
        if (!config.alertOnFullEnergy) return;

        const energy = getPlayerEnergyFromDom();
        if (!energy || energy.maximum <= 0) return;

        const isFull = energy.current >= energy.maximum;

        if (isFull) {
            const nowMs = Date.now();
            if (!lastEnergyAlertState || (nowMs - lastEnergyAlertTime > 10 * 60 * 1000)) {
                lastEnergyAlertState = true;
                lastEnergyAlertTime = nowMs;

                // Check active hospital targets for contextual information
                const nowSec = Math.floor(nowMs / 1000);
                const hospitalTargets = watchlist
                    .filter(id => !isTargetStricken(id))
                    .map(id => targetsCache[id]?.data)
                    .filter(d => d && d.state === 'Hospital');

                let subMsg = 'Train in Gym or attack before energy caps!';
                if (hospitalTargets.length > 0) {
                    let lowestRemaining = Infinity;
                    let targetContextName = '';
                    hospitalTargets.forEach(t => {
                        const rem = t.until > nowSec ? t.until - nowSec : 0;
                        if (rem < lowestRemaining) {
                            lowestRemaining = rem;
                            targetContextName = t.name;
                        }
                    });
                    const timeStr = formatCountdown(lowestRemaining);
                    subMsg = `Target [${targetContextName}] in Hosp (${timeStr}). Train off excess energy!`;
                }

                playStakeoutAlarm('bell');

                sendStakeoutNotification(
                    `🔔 Energy is 100% FULL (${energy.current}/${energy.maximum})!`,
                    subMsg
                );

                showStakeoutToast(`🔔 Energy is FULL (${energy.current}/${energy.maximum})! ${subMsg}`);
            }
        } else {
            lastEnergyAlertState = false;
        }
    }

    // --- 4.2 DRUG COOLDOWN BELL ALERT (LIGHTWEIGHT BACKGROUND MONITOR) ---
    let drugCooldownExpiresAt = 0;
    let drugWasActive = false;
    let drugAlertFired = true; // Initialized to true to prevent false alarms on initial page load
    let lastDrugApiSyncTime = 0;

    function isDrugActiveInDom() {
        try {
            const sidebar = document.getElementById('sidebarroot') || document.body;
            const direct = sidebar.querySelector(
                '[class*="icon49"], [class*="icon50"], [class*="icon51"], [class*="icon52"], [class*="icon53"], ' +
                '[id*="icon49"], [id*="icon50"], [id*="icon51"], [id*="icon52"], [id*="icon53"]'
            );
            if (direct) return true;

            const candidates = sidebar.querySelectorAll('[class*="status-icons"] a, [class*="status-icons"] li, [class*="status-icons"] div, [aria-label*="Drug" i], [title*="Drug" i], [title*="Cannabis" i]');
            for (const el of candidates) {
                const txt = `${el.className || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
                if (txt.includes('drug') || txt.includes('cannabis')) return true;
            }
        } catch (e) {}
        return false;
    }

    function triggerDrugCooldownBell() {
        drugAlertFired = true;
        drugWasActive = false;
        drugCooldownExpiresAt = 0;

        if (!config.alertOnDrugCooldown) return;

        playStakeoutAlarm('bell');

        showStakeoutToast('💊 Drug cooldown has ended! Ready to take another drug.');

        sendStakeoutNotification(
            '💊 Drug Cooldown Ready!',
            'Your drug cooldown has ended. You can now safely take another drug.'
        );
    }

    function checkDrugCooldownStatus() {
        if (!config.alertOnDrugCooldown) return;

        const nowMs = Date.now();
        const domActive = isDrugActiveInDom();

        if (domActive) {
            drugWasActive = true;
            drugAlertFired = false;
        }

        // Check if API timer has expired
        if (drugCooldownExpiresAt > 0) {
            if (nowMs >= drugCooldownExpiresAt) {
                triggerDrugCooldownBell();
            }
        } else if (drugWasActive && !drugAlertFired && !domActive) {
            // Drug icon was active previously and has now cleared from sidebar
            triggerDrugCooldownBell();
        }
    }

    async function syncDrugCooldownFromApi() {
        const apiKey = getApiKey();
        if (!apiKey) return;
        const nowMs = Date.now();
        if (nowMs - lastDrugApiSyncTime < 60000) return;
        if (getApiCallRate() >= 90) return;

        lastDrugApiSyncTime = nowMs;
        try {
            recordApiCall();
            const url = `https://api.torn.com/user/?selections=cooldowns&key=${apiKey}&comment=StakeoutPDADrug&timestamp=${nowMs}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.cooldowns && typeof data.cooldowns.drug === 'number') {
                const remSec = parseInt(data.cooldowns.drug, 10) || 0;
                if (remSec > 0) {
                    drugCooldownExpiresAt = Date.now() + remSec * 1000;
                    drugWasActive = true;
                    drugAlertFired = false;
                } else {
                    if (drugWasActive && !drugAlertFired) {
                        triggerDrugCooldownBell();
                    } else {
                        drugAlertFired = true;
                    }
                    drugCooldownExpiresAt = 0;
                }
            }
        } catch (e) {
            console.warn('[StakeoutPDA] Drug cooldown sync error:', e);
        }
    }

    // --- 5. TORN API POLLER & TELEMETRY ---
    async function fetchTargetTelemetry(targetId) {
        const apiKey = getApiKey();
        if (!apiKey) return null;

        if (getApiCallRate() >= 90) {
            console.warn('[StakeoutPDA] Rate limit threshold reached, skipping cycle');
            return null;
        }

        try {
            recordApiCall();
            const url = `https://api.torn.com/user/${targetId}?selections=profile,basic&key=${apiKey}&timestamp=${Date.now()}&comment=StakeoutPDARadar`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.error) {
                console.error('[StakeoutPDA] API error:', data.error);
                if (data.error.code === 2) {
                    showStakeoutToast('⚠️ Invalid Torn API Key! Tap ⚙ in Radar to update.');
                }
                return { error: data.error.error || 'API Error', code: data.error.code };
            }
            return data;
        } catch (e) {
            console.error('[StakeoutPDA] Network error:', e);
            return null;
        }
    }

    // --- 6. TRIGGER EVALUATION & ATTACK STAGING ENGINE ---
    function isTargetActiveWithinLimit(snapshot, nowSec = Math.floor(Date.now() / 1000), targetId = null) {
        if (!snapshot) return false;
        if (snapshot.online === 'Online') return true;

        const limitMin = targetId ? getTargetInactiveLimit(targetId) : (config.activeThresholdMin || 5);
        const limitSec = limitMin * 60;

        if (snapshot.lastActionTs && snapshot.lastActionTs > 0) {
            return (nowSec - snapshot.lastActionTs) <= limitSec;
        }

        if (snapshot.lastActionRel) {
            const rel = snapshot.lastActionRel.toLowerCase();
            const minMatch = rel.match(/(\d+)\s*(?:minute|min|m)\b/);
            if (minMatch) {
                const mins = parseInt(minMatch[1], 10);
                return mins <= limitMin;
            }
            const secMatch = rel.match(/(\d+)\s*(?:second|sec|s)\b/);
            if (secMatch) return true;
        }

        return false;
    }

    function isTargetAttackEligible(snapshot, nowSec = Math.floor(Date.now() / 1000), targetId = null) {
        if (!snapshot) return false;
        const isOutAndAlive = snapshot.state === 'Okay' && snapshot.hpCurr > 0;
        if (!isOutAndAlive) return false;
        return isTargetActiveWithinLimit(snapshot, nowSec, targetId);
    }

    function evaluateTargetTriggers(targetId, freshData) {
        if (!freshData || freshData.error) return;

        const currentSnapshot = {
            id: targetId,
            name: freshData.name || `[ID: ${targetId}]`,
            state: freshData.status?.state || 'Unknown',
            desc: freshData.status?.description || '',
            until: parseInt(freshData.status?.until || '0', 10),
            online: freshData.last_action?.status || 'Offline',
            lastActionRel: freshData.last_action?.relative || '',
            lastActionTs: parseInt(freshData.last_action?.timestamp || '0', 10),
            hpCurr: freshData.life?.current || 0,
            hpMax: freshData.life?.maximum || 0,
            hpPct: (freshData.life?.maximum > 0) ? (freshData.life.current / freshData.life.maximum) * 100 : 100,
            level: freshData.level || 0
        };

        const existing = targetsCache[targetId];
        const previous = existing ? existing.data : null;
        const nowSec = Math.floor(Date.now() / 1000);
        const limitMin = getTargetInactiveLimit(targetId);
        const isStricken = isTargetStricken(targetId);

        const isNowEligible = isTargetAttackEligible(currentSnapshot, nowSec, targetId);
        const wasEligible = previous ? isTargetAttackEligible(previous, nowSec, targetId) : false;

        // Stricken targets have alarms silenced so completed contracts do not sound sirens
        if (previous && !isStricken) {
            // Main attack alarm: target met BOTH criteria (Out & Alive + Active <= limitMin)
            const becameEligible = !wasEligible && isNowEligible;

            if (config.alertOnOkay && becameEligible) {
                playStakeoutAlarm('okay');
                sendStakeoutNotification(
                    `⚔️ ${currentSnapshot.name} is OUT & ACTIVE!`,
                    `Target is Out & Alive (Okay) and active (${currentSnapshot.online}, ${currentSnapshot.lastActionRel || `within ${limitMin}m`})!`
                );
                showStakeoutToast(`⚔️ Target [${currentSnapshot.name}] is OUT & ACTIVE (${currentSnapshot.online}, ${currentSnapshot.lastActionRel || `within ${limitMin}m`})! Attack now.`);
            }

            // Flight landing alert (Out & Alive + Active)
            if (config.alertOnLanding && previous.state === 'Traveling' && currentSnapshot.state !== 'Traveling') {
                if (!becameEligible && isNowEligible) {
                    playStakeoutAlarm('okay');
                    sendStakeoutNotification(
                        `${currentSnapshot.name} LANDED & ACTIVE!`,
                        `Flight arrived in Torn: Out & Alive • Active: ${currentSnapshot.online}`
                    );
                }
            }

            // Full 100% HP alert (Out & Alive + Active)
            if (config.alertOnFullHp && previous.hpPct < 100 && currentSnapshot.hpPct >= 100) {
                if (!becameEligible && isNowEligible) {
                    playStakeoutAlarm('okay');
                    sendStakeoutNotification(
                        `${currentSnapshot.name} 100% HP!`,
                        `Life fully recovered: ${currentSnapshot.hpCurr.toLocaleString()} / ${currentSnapshot.hpMax.toLocaleString()} • Active: ${currentSnapshot.online}`
                    );
                }
            }
        }

        targetsCache[targetId] = {
            data: currentSnapshot,
            lastChecked: Date.now()
        };

        updateTargetCardUI(targetId);
        updateRadarBadge();
    }

    // --- 7. STYLES (MOBILE-FIRST RESPONSIVE CSS) ---
    safeAddStyle(`
        #tornpda-radar-dock {
            position: fixed !important;
            bottom: 68px !important;
            z-index: 999999 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            color: #f1f5f9 !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            touch-action: manipulation !important;
        }
        #tornpda-radar-dock.dock-left {
            left: 10px !important;
            right: auto !important;
        }
        #tornpda-radar-dock.dock-right {
            right: 10px !important;
            left: auto !important;
        }

        .tornpda-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            background: rgba(15, 23, 42, 0.94) !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
            border: 1px solid #334155 !important;
            border-radius: 24px !important;
            padding: 8px 14px !important;
            font-size: 13px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5) !important;
            transition: all 0.2s ease !important;
            min-height: 40px !important;
        }
        .tornpda-pill:active {
            transform: scale(0.96) !important;
        }
        .tornpda-pill.has-ready {
            border-color: #22c55e !important;
            background: rgba(20, 83, 45, 0.94) !important;
            animation: tornpda-pulse-glow 1.5s infinite !important;
        }

        @keyframes tornpda-pulse-glow {
            0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
            100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }

        .tornpda-window {
            width: 340px !important;
            max-width: 92vw !important;
            max-height: 75vh !important;
            background: rgba(15, 23, 42, 0.96) !important;
            backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important;
            border: 1px solid #334155 !important;
            border-radius: 12px !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6) !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
        }

        .tornpda-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 12px !important;
            background: #0f172a !important;
            border-bottom: 1px solid #334155 !important;
        }
        .tornpda-title {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            font-size: 13px !important;
            font-weight: 800 !important;
            color: #f8fafc !important;
        }
        .tornpda-header-actions {
            display: flex !important;
            gap: 6px !important;
        }
        .tornpda-btn-icon {
            background: #1e293b !important;
            border: 1px solid #475569 !important;
            color: #cbd5e1 !important;
            border-radius: 6px !important;
            padding: 6px 10px !important;
            font-size: 13px !important;
            cursor: pointer !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: 32px !important;
            touch-action: manipulation !important;
        }
        .tornpda-btn-icon:active {
            background: #334155 !important;
            transform: scale(0.96) !important;
        }

        .tornpda-add-bar {
            padding: 8px 12px !important;
            display: flex !important;
            gap: 6px !important;
            background: #1e293b !important;
            border-bottom: 1px solid #334155 !important;
        }
        .tornpda-input {
            flex: 1 !important;
            background: #0f172a !important;
            border: 1px solid #475569 !important;
            color: #f8fafc !important;
            border-radius: 6px !important;
            padding: 6px 10px !important;
            font-size: 12px !important;
            outline: none !important;
        }
        .tornpda-input:focus {
            border-color: #38bdf8 !important;
        }
        .tornpda-btn-primary {
            background: #0284c7 !important;
            border: none !important;
            color: #fff !important;
            font-weight: 700 !important;
            padding: 6px 12px !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            font-size: 12px !important;
            min-height: 32px !important;
        }
        .tornpda-btn-primary:active {
            background: #0369a1 !important;
            transform: scale(0.96) !important;
        }

        .tornpda-body {
            flex: 1 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            padding: 8px 10px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
        }

        .tornpda-card {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
            padding: 9px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            transition: all 0.2s ease !important;
            position: relative !important;
        }
        .tornpda-card.ready-card {
            border-color: #22c55e !important;
            background: linear-gradient(180deg, rgba(34, 197, 94, 0.12) 0%, rgba(30, 41, 59, 1) 100%) !important;
        }
        .tornpda-card.stricken-card {
            border-color: #475569 !important;
            background: rgba(15, 23, 42, 0.7) !important;
            opacity: 0.85 !important;
        }

        .tornpda-card-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
        }
        .tornpda-card-name {
            font-size: 13px !important;
            font-weight: 800 !important;
            color: #f8fafc !important;
            text-decoration: none !important;
        }
        .tornpda-card-actions {
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
        }

        .tornpda-status-row {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            flex-wrap: wrap !important;
            font-size: 11px !important;
        }
        .tornpda-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 3px !important;
            padding: 2px 7px !important;
            border-radius: 4px !important;
            font-size: 10.5px !important;
            font-weight: 700 !important;
        }
        .tornpda-badge.badge-okay {
            background: rgba(34, 197, 94, 0.2) !important;
            color: #4ade80 !important;
            border: 1px solid #22c55e !important;
        }
        .tornpda-badge.badge-hosp {
            background: rgba(239, 68, 68, 0.2) !important;
            color: #f87171 !important;
            border: 1px solid #ef4444 !important;
        }
        .tornpda-badge.badge-hosp-ready {
            background: rgba(245, 158, 11, 0.25) !important;
            color: #fbbf24 !important;
            border: 1px solid #f59e0b !important;
            animation: tornpda-pulse-amber 1s infinite !important;
        }
        .tornpda-badge.badge-travel {
            background: rgba(14, 165, 233, 0.2) !important;
            color: #38bdf8 !important;
            border: 1px solid #0ea5e9 !important;
        }
        .tornpda-badge.badge-other {
            background: rgba(100, 116, 139, 0.2) !important;
            color: #cbd5e1 !important;
            border: 1px solid #64748b !important;
        }
        .tornpda-badge.badge-stricken {
            background: rgba(239, 68, 68, 0.2) !important;
            color: #fca5a5 !important;
            border: 1px solid #ef4444 !important;
            cursor: pointer !important;
        }

        .tornpda-online-dot {
            width: 8px !important;
            height: 8px !important;
            border-radius: 50% !important;
            display: inline-block !important;
        }
        .tornpda-online-dot.dot-online {
            background: #22c55e !important;
            box-shadow: 0 0 6px rgba(34, 197, 94, 0.8) !important;
        }
        .tornpda-online-dot.dot-idle {
            background: #f59e0b !important;
        }
        .tornpda-online-dot.dot-offline {
            background: #64748b !important;
        }

        .tornpda-btn-attack {
            width: 100% !important;
            padding: 8px 10px !important;
            border-radius: 6px !important;
            font-size: 12px !important;
            font-weight: 800 !important;
            cursor: pointer !important;
            border: none !important;
            text-align: center !important;
            text-decoration: none !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 1px !important;
            min-height: 42px !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
            touch-action: manipulation !important;
        }
        .tornpda-btn-attack.btn-ready {
            background: linear-gradient(180deg, #16a34a 0%, #15803d 100%) !important;
            color: #ffffff !important;
            border: 1px solid #22c55e !important;
        }
        .tornpda-btn-attack.btn-locked {
            background: #334155 !important;
            color: #94a3b8 !important;
            cursor: not-allowed !important;
            opacity: 0.85 !important;
        }

        .tornpda-settings {
            background: #0f172a !important;
            border-top: 1px solid #334155 !important;
            padding: 10px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            font-size: 12px !important;
            color: #cbd5e1 !important;
        }
        .tornpda-toggle-row {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            cursor: pointer !important;
            min-height: 28px !important;
        }
        .tornpda-toggle-row input {
            width: 18px !important;
            height: 18px !important;
            cursor: pointer !important;
        }

        .tornpda-footer {
            padding: 8px 12px !important;
            background: #0f172a !important;
            border-top: 1px solid #334155 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            font-size: 10px !important;
            color: #94a3b8 !important;
        }

        /* Profile page button */
        .tornpda-profile-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            background: rgba(30, 41, 59, 0.9) !important;
            border: 1px solid #3b82f6 !important;
            color: #93c5fd !important;
            padding: 4px 10px !important;
            border-radius: 4px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            margin-left: 6px !important;
            min-height: 30px !important;
            touch-action: manipulation !important;
        }
        .tornpda-profile-btn:active {
            background: #2563eb !important;
            color: #fff !important;
        }

        /* Toast popup */
        #tornpda-stakeout-toast {
            position: fixed !important;
            bottom: 120px !important;
            background: rgba(15, 23, 42, 0.96) !important;
            border: 1px solid #38bdf8 !important;
            color: #f0f9ff !important;
            padding: 9px 14px !important;
            border-radius: 8px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7) !important;
            z-index: 9999999 !important;
            pointer-events: none !important;
            transition: opacity 0.3s ease !important;
            max-width: 90vw !important;
        }
        #tornpda-stakeout-toast.position-left { left: 14px !important; }
        #tornpda-stakeout-toast.position-right { right: 14px !important; }
        #tornpda-stakeout-toast.fade-out { opacity: 0 !important; }

        /* Update banner */
        #tornpda-stakeout-update-banner {
            position: fixed !important;
            top: 10px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: #0f172a !important;
            border: 1px solid #38bdf8 !important;
            color: #f8fafc !important;
            padding: 8px 14px !important;
            border-radius: 8px !important;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7) !important;
            z-index: 9999999 !important;
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
        }
    `);

    // --- 8. RATE LIMITING ENGINE (Max 90 calls/min) ---
    const API_CALL_TIMESTAMPS = [];
    function recordApiCall() {
        const now = Date.now();
        API_CALL_TIMESTAMPS.push(now);
        pruneApiCallHistory(now);
    }
    function pruneApiCallHistory(now = Date.now()) {
        const cutoff = now - 60000;
        while (API_CALL_TIMESTAMPS.length > 0 && API_CALL_TIMESTAMPS[0] < cutoff) {
            API_CALL_TIMESTAMPS.shift();
        }
    }
    function getApiCallRate() {
        pruneApiCallHistory();
        return API_CALL_TIMESTAMPS.length;
    }

    // --- 9. UI RENDERING & MOBILE DOCK MANAGEMENT ---
    function applyDockPosition() {
        if (!dockRoot) return;
        dockRoot.className = (config.dockPosition === 'right') ? 'dock-right' : 'dock-left';
    }

    function renderRadarUI() {
        if (!document.body) return;

        if (!dockRoot) {
            dockRoot = document.createElement('div');
            dockRoot.id = 'tornpda-radar-dock';
            document.body.appendChild(dockRoot);
        }
        applyDockPosition();

        const nowSec = Math.floor(Date.now() / 1000);
        const readyCount = watchlist.filter(id => {
            if (isTargetStricken(id)) return false;
            const t = targetsCache[id]?.data;
            return t && isTargetAttackEligible(t, nowSec, id);
        }).length;

        if (config.isMinimized) {
            dockRoot.innerHTML = `
                <div class="tornpda-pill ${readyCount > 0 ? 'has-ready' : ''}" id="tornpda-pill-toggle">
                    <span>🎯</span>
                    <span>Radar (${watchlist.length})${readyCount > 0 ? ` • ⚡ ${readyCount} READY` : ''}</span>
                </div>
            `;
            const toggleEl = document.getElementById('tornpda-pill-toggle');
            if (toggleEl) {
                toggleEl.onclick = () => {
                    config.isMinimized = false;
                    saveConfig();
                    renderRadarUI();
                };
            }
            return;
        }

        const callRate = getApiCallRate();
        const keyDetails = getApiKeyDetails();

        dockRoot.innerHTML = `
            <div class="tornpda-window">
                <div class="tornpda-header">
                    <div class="tornpda-title">
                        <span>🎯</span>
                        <span>Stakeout Radar</span>
                        <span style="font-size: 10px; color: ${config.isPaused ? '#f59e0b' : '#22c55e'}; font-weight: 700;">
                            ${config.isPaused ? '⏸ PAUSED' : '● SCANNING'}
                        </span>
                    </div>
                    <div class="tornpda-header-actions">
                        <button class="tornpda-btn-icon" id="tornpda-btn-pause" title="${config.isPaused ? 'Resume' : 'Pause'}">
                            ${config.isPaused ? '▶' : '⏸'}
                        </button>
                        <button class="tornpda-btn-icon" id="tornpda-btn-settings" title="Settings">⚙</button>
                        <button class="tornpda-btn-icon" id="tornpda-btn-minimize" title="Minimize">−</button>
                    </div>
                </div>

                <div class="tornpda-add-bar">
                    <input type="text" class="tornpda-input" id="tornpda-input-target" placeholder="Enter Player ID or Profile URL..." />
                    <button class="tornpda-btn-primary" id="tornpda-btn-add">+ Add</button>
                </div>

                <div id="tornpda-settings-panel" class="tornpda-settings" style="display: none;">
                    <div style="font-weight: 800; color: #f8fafc; margin-bottom: 2px;">🎯 Mobile Stakeout Triggers:</div>
                    <label class="tornpda-toggle-row" title="Requires target to meet BOTH criteria: 1. Out & Alive, and 2. Online or last action within configured limit">
                        <span>⚔️ Alert on Attack Eligible (Out & Active)</span>
                        <input type="checkbox" id="toggle-alert-okay" ${config.alertOnOkay ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row" title="Choose whether the Attack button opens the direct combat attack page or the user profile page for double confirmation">
                        <span>⚔️ Attack Button Target</span>
                        <select id="tornpda-attack-dest-select" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer;">
                            <option value="attack" ${(config.attackDestination || 'attack') === 'attack' ? 'selected' : ''}>⚔️ Direct Attack Page</option>
                            <option value="profile" ${(config.attackDestination || 'attack') === 'profile' ? 'selected' : ''}>👤 Profile (Double Confirm)</option>
                        </select>
                    </label>
                    <label class="tornpda-toggle-row" title="Global threshold for activity (Online or last action within this many minutes)">
                        <span>⏱️ Inactive Limit (Default)</span>
                        <select id="tornpda-inactive-select" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer;">
                            <option value="2" ${(config.activeThresholdMin || 5) === 2 ? 'selected' : ''}>2 Mins</option>
                            <option value="5" ${(config.activeThresholdMin || 5) === 5 ? 'selected' : ''}>5 Mins (Default)</option>
                            <option value="10" ${(config.activeThresholdMin || 5) === 10 ? 'selected' : ''}>10 Mins</option>
                            <option value="15" ${(config.activeThresholdMin || 5) === 15 ? 'selected' : ''}>15 Mins</option>
                            <option value="30" ${(config.activeThresholdMin || 5) === 30 ? 'selected' : ''}>30 Mins</option>
                            <option value="60" ${(config.activeThresholdMin || 5) === 60 ? 'selected' : ''}>60 Mins (1 Hour)</option>
                        </select>
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>Alert on Flight Landing (Out & Active)</span>
                        <input type="checkbox" id="toggle-alert-landing" ${config.alertOnLanding ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>Alert on Full 100% HP</span>
                        <input type="checkbox" id="toggle-alert-fullhp" ${config.alertOnFullHp ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row" title="Plays a golden bell chime when your Energy reaches 100% while waiting for hospital targets, so you can train off energy without capping">
                        <span>🔔 Energy Full Bell (Train Reminder)</span>
                        <input type="checkbox" id="toggle-alert-fullenergy" ${config.alertOnFullEnergy ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row" title="Plays a melodic bell chime and notifies you when your Drug cooldown reaches 0:00 (Ready to take another drug)">
                        <span>💊 Drug Cooldown Bell</span>
                        <input type="checkbox" id="toggle-alert-drug" ${config.alertOnDrugCooldown ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>Audio Sound Alarm</span>
                        <input type="checkbox" id="toggle-sound-alarm" ${config.soundAlarm ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row" title="Mobile vibration buzz when a target becomes ready or bells fire">
                        <span>📳 Mobile Haptic Vibration</span>
                        <input type="checkbox" id="toggle-vibrate-alarm" ${config.vibrateAlarm ? 'checked' : ''} />
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>🔊 Alarm Volume</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="tornpda-vol-slider" min="10" max="100" value="${Math.round((config.alarmVolume ?? 1.0) * 100)}" style="width: 80px; accent-color: #38bdf8;" />
                            <span id="tornpda-vol-label" style="font-size: 11px; font-family: monospace; min-width: 32px; text-align: right; color: #38bdf8;">${Math.round((config.alarmVolume ?? 1.0) * 100)}%</span>
                        </div>
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>🎵 Combat Alarm Sound</span>
                        <select id="tornpda-sound-select" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer;">
                            <option value="siren" ${(config.alarmSoundType || 'siren') === 'siren' ? 'selected' : ''}>🚨 Emergency Siren (Loudest)</option>
                            <option value="horn" ${(config.alarmSoundType || 'siren') === 'horn' ? 'selected' : ''}>📯 Tactical Air Horn</option>
                            <option value="klaxon" ${(config.alarmSoundType || 'siren') === 'klaxon' ? 'selected' : ''}>⚠️ Heavy Klaxon</option>
                            <option value="chime" ${(config.alarmSoundType || 'siren') === 'chime' ? 'selected' : ''}>🔔 Bright Chime</option>
                        </select>
                    </label>
                    <label class="tornpda-toggle-row">
                        <span>📍 Dock Position</span>
                        <select id="tornpda-position-select" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer;">
                            <option value="left" ${(config.dockPosition || 'left') === 'left' ? 'selected' : ''}>Bottom Left (Default)</option>
                            <option value="right" ${(config.dockPosition || 'left') === 'right' ? 'selected' : ''}>Bottom Right</option>
                        </select>
                    </label>

                    <div style="border-top: 1px solid #334155; margin-top: 4px; padding-top: 6px;">
                        <div style="font-weight: 800; color: #f8fafc; margin-bottom: 4px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
                            <span>🔑 Torn API Key</span>
                            <button class="tornpda-btn-icon" id="tornpda-btn-set-key" style="padding: 2px 8px; font-size: 10px; border-color: #38bdf8; color: #38bdf8;" title="Change Key">Change Key</button>
                        </div>
                        <div style="font-size: 10.5px; color: #94a3b8; line-height: 1.4;">
                            <div>Active: <strong style="color: ${keyDetails.key ? '#38bdf8' : '#ef4444'}; font-family: monospace;">${maskApiKey(keyDetails.key)}</strong></div>
                            <div>Source: <span style="color: #cbd5e1;">${keyDetails.source}</span></div>
                            ${keyDetails.uid ? `<div style="color: #64748b;">Logged-in User ID: [${keyDetails.uid}]</div>` : ''}
                        </div>
                    </div>

                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        <button class="tornpda-btn-icon" id="tornpda-btn-test-sound" style="flex: 1; padding: 4px;" title="Test Siren Alarm">🔊 Siren</button>
                        <button class="tornpda-btn-icon" id="tornpda-btn-test-bell" style="flex: 1; padding: 4px; border-color: #f59e0b; color: #fbbf24;" title="Test Melodic Bell">🔔 Bell</button>
                        <button class="tornpda-btn-icon" id="tornpda-btn-check-update" style="flex: 1; padding: 4px; border-color: #38bdf8; color: #38bdf8;" title="Check for Updates">🔄 Updates</button>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 2px;">
                        <span>TornPDA Radar v${SCRIPT_VERSION}</span>
                        <span id="tornpda-footer-rate">Rate: ${callRate}/90 cpm</span>
                    </div>
                </div>

                <div class="tornpda-body" id="tornpda-target-list">
                    ${watchlist.length === 0 ? `<div style="text-align: center; color: #94a3b8; font-size: 11px; padding: 16px 0;">${!keyDetails.key ? '<span style="color: #f87171; font-weight: 700;">⚠️ API Key Missing!</span><br>Tap ⚙ (Settings) &gt; "Change Key" to start scanning.<br><br>' : ''}No targets on watchlist.<br>Add an ID above or tap "🎯 Stakeout" on any profile!</div>` : ''}
                </div>

                <div class="tornpda-footer">
                    <span>Watchlist: ${watchlist.length} target${watchlist.length === 1 ? '' : 's'}</span>
                    <span id="tornpda-footer-poll-status">${currentPollingIntervalMs === 1000 ? '⚡ 1s Rapid' : `${config.pollingInterval || 5}s Poll`}</span>
                </div>
            </div>
        `;

        setupSettingsListeners();

        const listContainer = document.getElementById('tornpda-target-list');
        if (listContainer && watchlist.length > 0) {
            watchlist.forEach(id => {
                const card = document.createElement('div');
                card.id = `tornpda-card-${id}`;
                card.className = 'tornpda-card';
                listContainer.appendChild(card);
                updateTargetCardUI(id);
            });
        }
    }

    function setupSettingsListeners() {
        const minBtn = document.getElementById('tornpda-btn-minimize');
        if (minBtn) {
            minBtn.onclick = () => {
                config.isMinimized = true;
                saveConfig();
                renderRadarUI();
            };
        }

        const pauseBtn = document.getElementById('tornpda-btn-pause');
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                config.isPaused = !config.isPaused;
                saveConfig();
                renderRadarUI();
            };
        }

        const settingsPanel = document.getElementById('tornpda-settings-panel');
        const settingsBtn = document.getElementById('tornpda-btn-settings');
        if (settingsBtn && settingsPanel) {
            settingsBtn.onclick = () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
            };
        }

        const tOkay = document.getElementById('toggle-alert-okay');
        if (tOkay) tOkay.onchange = (e) => { config.alertOnOkay = e.target.checked; saveConfig(); };

        const attackDestSelect = document.getElementById('tornpda-attack-dest-select');
        if (attackDestSelect) {
            attackDestSelect.onchange = (e) => {
                config.attackDestination = e.target.value;
                saveConfig();
                showStakeoutToast(config.attackDestination === 'profile'
                    ? '👤 Attack button set to open Target Profile (for confirmation).'
                    : '⚔️ Attack button set to open Direct Attack page.');
                watchlist.forEach(id => updateTargetCardUI(id));
            };
        }

        const inactiveSelect = document.getElementById('tornpda-inactive-select');
        if (inactiveSelect) {
            inactiveSelect.onchange = (e) => {
                config.activeThresholdMin = parseInt(e.target.value, 10) || 5;
                saveConfig();
                renderRadarUI();
            };
        }

        const tLanding = document.getElementById('toggle-alert-landing');
        if (tLanding) tLanding.onchange = (e) => { config.alertOnLanding = e.target.checked; saveConfig(); };

        const tFullHp = document.getElementById('toggle-alert-fullhp');
        if (tFullHp) tFullHp.onchange = (e) => { config.alertOnFullHp = e.target.checked; saveConfig(); };

        const tFullEnergy = document.getElementById('toggle-alert-fullenergy');
        if (tFullEnergy) {
            tFullEnergy.onchange = (e) => {
                config.alertOnFullEnergy = e.target.checked;
                saveConfig();
                if (e.target.checked) playStakeoutAlarm('bell');
            };
        }

        const tDrug = document.getElementById('toggle-alert-drug');
        if (tDrug) {
            tDrug.onchange = (e) => {
                config.alertOnDrugCooldown = e.target.checked;
                saveConfig();
                if (e.target.checked) playStakeoutAlarm('bell');
            };
        }

        const tSound = document.getElementById('toggle-sound-alarm');
        if (tSound) tSound.onchange = (e) => { config.soundAlarm = e.target.checked; saveConfig(); };

        const tVibrate = document.getElementById('toggle-vibrate-alarm');
        if (tVibrate) {
            tVibrate.onchange = (e) => {
                config.vibrateAlarm = e.target.checked;
                saveConfig();
                if (e.target.checked) triggerHaptic('alarm');
            };
        }

        const volSlider = document.getElementById('tornpda-vol-slider');
        const volLabel = document.getElementById('tornpda-vol-label');
        if (volSlider) {
            volSlider.oninput = (e) => {
                const val = parseInt(e.target.value, 10) || 100;
                config.alarmVolume = val / 100;
                if (volLabel) volLabel.textContent = `${val}%`;
            };
            volSlider.onchange = () => saveConfig();
        }

        const soundSelect = document.getElementById('tornpda-sound-select');
        if (soundSelect) {
            soundSelect.onchange = (e) => {
                config.alarmSoundType = e.target.value;
                saveConfig();
                playStakeoutAlarm('test');
            };
        }

        const posSelect = document.getElementById('tornpda-position-select');
        if (posSelect) {
            posSelect.onchange = (e) => {
                config.dockPosition = e.target.value;
                saveConfig();
                applyDockPosition();
                showStakeoutToast(`📍 Radar moved to ${config.dockPosition === 'left' ? 'Bottom Left' : 'Bottom Right'}.`);
            };
        }

        const testSoundBtn = document.getElementById('tornpda-btn-test-sound');
        if (testSoundBtn) testSoundBtn.onclick = () => playStakeoutAlarm('test');

        const testBellBtn = document.getElementById('tornpda-btn-test-bell');
        if (testBellBtn) testBellBtn.onclick = () => playStakeoutAlarm('bell');

        const checkUpdateBtn = document.getElementById('tornpda-btn-check-update');
        if (checkUpdateBtn) checkUpdateBtn.onclick = () => checkForScriptUpdates(true);

        const setKeyBtn = document.getElementById('tornpda-btn-set-key');
        if (setKeyBtn) setKeyBtn.onclick = promptSetApiKey;

        const inputEl = document.getElementById('tornpda-input-target');
        const addBtn = document.getElementById('tornpda-btn-add');
        const handleAdd = () => {
            if (!inputEl) return;
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
                alert('Please enter a valid numeric Torn Player ID or Profile URL.');
            }
        };

        if (addBtn) addBtn.onclick = handleAdd;
        if (inputEl) {
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') handleAdd();
            };
        }
    }

    function updateRadarBadge() {
        if (!config.isMinimized) return;
        renderRadarUI();
    }

    function formatCountdown(sec) {
        if (sec <= 0) return 'READY';
        if (sec < 60) return `${sec}s`;
        const totalMin = Math.floor(sec / 60);
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        const seconds = sec % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;
        }
        return `${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;
    }

    function updateTargetCardUI(targetId) {
        const card = document.getElementById(`tornpda-card-${targetId}`);
        if (!card) return;

        const info = targetsCache[targetId];
        const isStricken = isTargetStricken(targetId);
        const currentLimit = getTargetInactiveLimit(targetId);
        const destMode = config.attackDestination || 'attack';

        if (!info || !info.data) {
            card.className = `tornpda-card ${isStricken ? 'stricken-card' : ''}`;
            card.innerHTML = `
                <div class="tornpda-card-header">
                    <span class="tornpda-card-name">Player [${targetId}]</span>
                    <div class="tornpda-card-actions">
                        <button class="tornpda-btn-icon" data-toggle-stricken="${targetId}" style="padding: 2px 6px; font-size: 11px;" title="Toggle Stricken">🎯</button>
                        <button class="tornpda-btn-icon" data-del="${targetId}" style="padding: 2px 6px; font-size: 11px; color: #f87171;" title="Remove">✕</button>
                    </div>
                </div>
                <div style="font-size: 11px; color: #94a3b8;">Fetching live status...</div>
            `;
            bindCardActions(card, targetId);
            return;
        }

        const d = info.data;
        const nowSec = Math.floor(Date.now() / 1000);
        const isEligible = isTargetAttackEligible(d, nowSec, targetId);
        const overdueSec = (d.state === 'Hospital' && d.until > 0 && nowSec >= d.until) ? (nowSec - d.until) : 0;

        let statusBadgeHtml = '';
        if (d.state === 'Okay') {
            statusBadgeHtml = `<span class="tornpda-badge badge-okay">● Okay</span>`;
        } else if (d.state === 'Hospital') {
            if (overdueSec > 0) {
                statusBadgeHtml = `<span class="tornpda-badge badge-hosp-ready">⚡ Hosp: Ready (+${overdueSec}s)</span>`;
            } else {
                const rem = d.until > nowSec ? d.until - nowSec : 0;
                statusBadgeHtml = `<span class="tornpda-badge badge-hosp">🏥 Hosp (${formatCountdown(rem)})</span>`;
            }
        } else if (d.state === 'Traveling') {
            statusBadgeHtml = `<span class="tornpda-badge badge-travel">✈️ ${d.desc || 'Traveling'}</span>`;
        } else {
            statusBadgeHtml = `<span class="tornpda-badge badge-other">${d.state}</span>`;
        }

        let dotClass = 'dot-offline';
        if (d.online === 'Online') dotClass = 'dot-online';
        else if (d.online === 'Idle') dotClass = 'dot-idle';

        let attackButtonHtml = '';
        if (isEligible) {
            const attackUrl = destMode === 'profile'
                ? `https://www.torn.com/profiles.php?XID=${targetId}`
                : `https://www.torn.com/loader.php?sid=attack&user2ID=${targetId}`;

            const mainLabel = destMode === 'profile' ? '👤 VIEW PROFILE' : '⚔️ ATTACK TARGET';
            const subLabel = isStricken ? '🎯 (STRICKEN)' : (destMode === 'profile' ? '🔍 (DOUBLE CONFIRM)' : '⚡ (READY & ACTIVE!)');

            attackButtonHtml = `
                <a href="${attackUrl}" target="_blank" class="tornpda-btn-attack btn-ready" style="text-decoration: none;">
                    <span>${mainLabel}</span>
                    <span style="font-size: 9.5px; opacity: 0.9;">${subLabel}</span>
                </a>
            `;
        } else {
            let reason = 'Target Not Ready';
            if (d.state === 'Hospital') {
                const rem = d.until > nowSec ? d.until - nowSec : 0;
                reason = overdueSec > 0 ? `Release Tick Pending (+${overdueSec}s)` : `Hospital (${formatCountdown(rem)})`;
            } else if (d.state !== 'Okay') {
                reason = d.state;
            } else if (!isTargetActiveWithinLimit(d, nowSec, targetId)) {
                reason = `Inactive (> ${currentLimit}m)`;
            }

            attackButtonHtml = `
                <button class="tornpda-btn-attack btn-locked" disabled>
                    <span>🔒 CANNOT ATTACK</span>
                    <span style="font-size: 9.5px;">${reason}</span>
                </button>
            `;
        }

        card.className = `tornpda-card ${isEligible ? 'ready-card' : ''} ${isStricken ? 'stricken-card' : ''}`;
        card.innerHTML = `
            <div class="tornpda-card-header">
                <a href="https://www.torn.com/profiles.php?XID=${targetId}" target="_blank" class="tornpda-card-name">
                    ${d.name} [${targetId}]
                </a>
                <div class="tornpda-card-actions">
                    <button class="tornpda-btn-icon" data-toggle-stricken="${targetId}" style="padding: 2px 6px; font-size: 11px; ${isStricken ? 'border-color: #ef4444; color: #fca5a5;' : ''}" title="Tap to toggle Stricken">🎯</button>
                    <button class="tornpda-btn-icon" data-del="${targetId}" style="padding: 2px 6px; font-size: 11px; color: #f87171;" title="Remove target">✕</button>
                </div>
            </div>

            <div class="tornpda-status-row">
                ${statusBadgeHtml}
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: #cbd5e1;">
                    <span class="tornpda-online-dot ${dotClass}"></span>
                    <span>${d.online}</span>
                    ${d.lastActionRel ? `<span style="color: #94a3b8;">(${d.lastActionRel})</span>` : ''}
                </span>
                ${isStricken ? '<span class="tornpda-badge badge-stricken" data-toggle-stricken="' + targetId + '">🎯 STRICKEN</span>' : ''}
            </div>

            <div style="font-size: 10.5px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
                <span>HP: ${d.hpCurr.toLocaleString()} / ${d.hpMax.toLocaleString()} (${Math.round(d.hpPct)}%)</span>
                <span style="display: flex; align-items: center; gap: 4px;">
                    <span>Limit:</span>
                    <select data-limit-select="${targetId}" style="background: #0f172a; border: 1px solid #475569; color: #f8fafc; font-size: 10px; border-radius: 3px; padding: 1px 3px;">
                        <option value="2" ${currentLimit === 2 ? 'selected' : ''}>2m</option>
                        <option value="5" ${currentLimit === 5 ? 'selected' : ''}>5m</option>
                        <option value="10" ${currentLimit === 10 ? 'selected' : ''}>10m</option>
                        <option value="15" ${currentLimit === 15 ? 'selected' : ''}>15m</option>
                        <option value="30" ${currentLimit === 30 ? 'selected' : ''}>30m</option>
                        <option value="60" ${currentLimit === 60 ? 'selected' : ''}>60m</option>
                    </select>
                </span>
            </div>

            ${attackButtonHtml}
        `;

        bindCardActions(card, targetId);
    }

    function bindCardActions(card, targetId) {
        // Delete button
        const delBtn = card.querySelector(`[data-del="${targetId}"]`);
        if (delBtn) {
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Remove [${targetsCache[targetId]?.data?.name || targetId}] from Stakeout Radar?`)) {
                    watchlist = watchlist.filter(id => id !== targetId);
                    saveWatchlist();
                    delete targetsCache[targetId];
                    renderRadarUI();
                    showStakeoutToast('Target removed from radar.');
                }
            };
        }

        // Tap on 🎯 icon or 🎯 STRICKEN badge to toggle Stricken
        const strickenBtns = card.querySelectorAll(`[data-toggle-stricken="${targetId}"]`);
        strickenBtns.forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                toggleTargetStricken(targetId);
            };
        });

        // Inactive limit dropdown
        const limitSelect = card.querySelector(`[data-limit-select="${targetId}"]`);
        if (limitSelect) {
            limitSelect.onchange = (e) => {
                e.stopPropagation();
                setTargetInactiveLimit(targetId, e.target.value);
                updateTargetCardUI(targetId);
                updateRadarBadge();
            };
        }

        // Touch Long-Press gesture for mobile (hold 500ms to toggle Stricken)
        let pressTimer = null;
        let startX = 0;
        let startY = 0;

        card.ontouchstart = (e) => {
            if (e.target.closest('button') || e.target.closest('select') || e.target.closest('a')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            pressTimer = setTimeout(() => {
                triggerHaptic('tap');
                toggleTargetStricken(targetId);
            }, 550);
        };

        card.ontouchmove = (e) => {
            if (!pressTimer) return;
            const deltaX = Math.abs(e.touches[0].clientX - startX);
            const deltaY = Math.abs(e.touches[0].clientY - startY);
            if (deltaX > 10 || deltaY > 10) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        card.ontouchend = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        card.ontouchcancel = card.ontouchend;

        // Desktop right-click fallback
        card.oncontextmenu = (e) => {
            if (e.target.closest('select') || e.target.closest('[data-del]')) return;
            e.preventDefault();
            toggleTargetStricken(targetId);
        };
    }

    function toggleTargetStricken(targetId) {
        const nextStricken = !isTargetStricken(targetId);
        setTargetStricken(targetId, nextStricken);
        const name = targetsCache[targetId]?.data?.name || `[ID: ${targetId}]`;
        showStakeoutToast(nextStricken ? `🎯 Target ${name} marked as STRICKEN.` : `Target ${name} unmarked from Stricken.`);
        checkAndAdjustPollingInterval();
        updateTargetCardUI(targetId);
        updateRadarBadge();
    }

    function updateDockFooterRate() {
        const rateEl = document.getElementById('tornpda-footer-rate');
        if (rateEl) {
            const callRate = getApiCallRate();
            rateEl.textContent = `Rate: ${callRate}/90 cpm`;
        }
        const pollEl = document.getElementById('tornpda-footer-poll-status');
        if (pollEl) {
            pollEl.innerHTML = currentPollingIntervalMs === 1000 ? '<b style="color: #f59e0b;">⚡ 1s Rapid</b>' : `${config.pollingInterval || 5}s Poll`;
        }
    }

    // --- 10. PROFILE PAGE 1-CLICK RADAR STAKEOUT BUTTON ---
    function updateProfilePageButton() {
        if (!window.location.href.includes('profiles.php')) return;
        const match = window.location.href.match(/XID=(\d+)/);
        if (!match) return;

        const targetId = match[1];
        const existing = document.getElementById('tornpda-stakeout-profile-btn');
        if (existing) {
            const isAdded = watchlist.includes(targetId);
            existing.textContent = isAdded ? '🎯 Staked (Remove)' : '🎯 Stakeout';
            existing.style.borderColor = isAdded ? '#22c55e' : '#3b82f6';
            existing.style.color = isAdded ? '#4ade80' : '#93c5fd';
            return;
        }

        const nameContainer = document.querySelector('.profile-wrapper .user-name, [class*="userName___"], .profile-container, .profile-heading');
        if (!nameContainer) return;

        const isAdded = watchlist.includes(targetId);
        const btn = document.createElement('button');
        btn.id = 'tornpda-stakeout-profile-btn';
        btn.className = 'tornpda-profile-btn';
        btn.textContent = isAdded ? '🎯 Staked (Remove)' : '🎯 Stakeout';
        if (isAdded) {
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#4ade80';
        }

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (watchlist.includes(targetId)) {
                watchlist = watchlist.filter(id => id !== targetId);
                saveWatchlist();
                delete targetsCache[targetId];
                btn.textContent = '🎯 Stakeout';
                btn.style.borderColor = '#3b82f6';
                btn.style.color = '#93c5fd';
                showStakeoutToast(`Removed [${targetId}] from Stakeout Radar.`);
            } else {
                watchlist.push(targetId);
                saveWatchlist();
                btn.textContent = '🎯 Staked (Remove)';
                btn.style.borderColor = '#22c55e';
                btn.style.color = '#4ade80';
                showStakeoutToast(`Added [${targetId}] to Stakeout Radar!`);
                pollSingleTarget(targetId);
            }
            renderRadarUI();
        };

        nameContainer.appendChild(btn);
    }

    // --- 11. DYNAMIC POLLING & BACKGROUND SCHEDULING ---
    function getRapidHospTarget() {
        if (!config.rapidHospPolling || watchlist.length === 0) return null;
        const nowSec = Math.floor(Date.now() / 1000);
        let bestTarget = null;
        let lowestRemaining = Infinity;

        // Priority 1: Un-stricken targets nearing discharge (<= 60s)
        for (const id of watchlist) {
            if (isTargetStricken(id)) continue;
            const info = targetsCache[id]?.data;
            if (info && info.state === 'Hospital') {
                const rem = info.until - nowSec;
                if (rem <= 60 && rem >= -60 && rem < lowestRemaining) {
                    lowestRemaining = rem;
                    bestTarget = id;
                }
            }
        }

        // Priority 2: Stricken targets fallback
        if (!bestTarget) {
            for (const id of watchlist) {
                const info = targetsCache[id]?.data;
                if (info && info.state === 'Hospital') {
                    const rem = info.until - nowSec;
                    if (rem <= 60 && rem >= -60 && rem < lowestRemaining) {
                        lowestRemaining = rem;
                        bestTarget = id;
                    }
                }
            }
        }

        return bestTarget;
    }

    function checkAndAdjustPollingInterval() {
        if (!backgroundTicker) return;
        const rapidTarget = getRapidHospTarget();
        const desiredIntervalMs = rapidTarget ? 1000 : (config.pollingInterval || 5) * 1000;

        if (desiredIntervalMs !== currentPollingIntervalMs) {
            const wasSlower = currentPollingIntervalMs > desiredIntervalMs;
            currentPollingIntervalMs = desiredIntervalMs;
            backgroundTicker.setIntervalMs(desiredIntervalMs);
            updateDockFooterRate();
            if (wasSlower && desiredIntervalMs === 1000 && rapidTarget) {
                pollSingleTarget(rapidTarget);
            }
        }
    }

    async function pollSingleTarget(targetId) {
        const fresh = await fetchTargetTelemetry(targetId);
        if (fresh) {
            evaluateTargetTriggers(targetId, fresh);
            checkAndAdjustPollingInterval();
        }
    }

    async function pollNextWatchlistTarget() {
        if (config.isPaused || watchlist.length === 0 || isPolling) return;
        isPolling = true;

        try {
            const rapidTargetId = getRapidHospTarget();
            const targetToPoll = rapidTargetId || watchlist[pollIndex % watchlist.length];

            if (!rapidTargetId) {
                pollIndex = (pollIndex + 1) % watchlist.length;
            }

            await pollSingleTarget(targetToPoll);
        } finally {
            isPolling = false;
            checkAndAdjustPollingInterval();
        }
    }

    function createBackgroundTicker(initialIntervalMs, callback) {
        let currentInterval = initialIntervalMs;
        let workerRef = null;
        let fallbackTimer = null;

        try {
            const blobCode = `
                let timer = null;
                let interval = ${initialIntervalMs};
                self.onmessage = function(e) {
                    const data = e.data;
                    if (data === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(function() { self.postMessage('tick'); }, interval);
                    } else if (data === 'stop') {
                        if (timer) clearInterval(timer);
                        timer = null;
                    } else if (typeof data === 'object' && data.type === 'setInterval') {
                        interval = data.intervalMs;
                        if (timer) {
                            clearInterval(timer);
                            timer = setInterval(function() { self.postMessage('tick'); }, interval);
                        }
                    }
                };
            `;
            const blob = new Blob([blobCode], { type: 'application/javascript' });
            workerRef = new Worker(URL.createObjectURL(blob));
            workerRef.onmessage = function (e) {
                if (e.data === 'tick') callback();
            };
            workerRef.postMessage('start');
        } catch (e) {
            console.warn('[StakeoutPDA] Web Worker fallback to setInterval:', e);
            fallbackTimer = setInterval(callback, initialIntervalMs);
        }

        return {
            setIntervalMs: (newIntervalMs) => {
                if (newIntervalMs === currentInterval) return;
                currentInterval = newIntervalMs;
                if (workerRef) {
                    workerRef.postMessage({ type: 'setInterval', intervalMs: newIntervalMs });
                } else if (fallbackTimer) {
                    clearInterval(fallbackTimer);
                    fallbackTimer = setInterval(callback, newIntervalMs);
                }
            },
            terminate: () => {
                if (workerRef) {
                    workerRef.postMessage('stop');
                    workerRef.terminate();
                }
                if (fallbackTimer) clearInterval(fallbackTimer);
            }
        };
    }

    // --- 12. BOOTSTRAP & TORN PDA LIFECYCLE ---
    function boot() {
        if (!document.body) {
            setTimeout(boot, 100);
            return;
        }

        renderRadarUI();
        updateProfilePageButton();

        // 1-Second safe loop for countdowns, hospital rapid polling & vitality checks
        setInterval(() => {
            checkEnergyStatus();
            checkDrugCooldownStatus();
            checkAndAdjustPollingInterval();
            updateDockFooterRate();
            if (config.isMinimized || watchlist.length === 0) return;
            watchlist.forEach(id => updateTargetCardUI(id));
        }, 1000);

        // Safe 2-second checker for profile button without heavy MutationObserver
        setInterval(() => {
            if (window.location.href.includes('profiles.php')) {
                updateProfilePageButton();
            }
        }, 2000);

        // Periodic drug cooldown check from API (every 60s)
        setTimeout(() => syncDrugCooldownFromApi(), 2000);
        setInterval(() => syncDrugCooldownFromApi(), 60000);

        // Main unthrottled poller (Web Worker with fallback)
        backgroundTicker = createBackgroundTicker(currentPollingIntervalMs, pollNextWatchlistTarget);

        // Initial fetch for all targets
        if (watchlist.length > 0) {
            watchlist.forEach((id, idx) => {
                setTimeout(() => pollSingleTarget(id), idx * 1500);
            });
        }

        // Silent background update check once every 24h
        setTimeout(autoCheckForUpdates, 4000);
    }

    // Torn PDA Re-injection recheck hook
    window.__TORNPDA_STAKEOUT_RADAR_RECHECK__ = function () {
        if (!document.getElementById('tornpda-radar-dock')) {
            renderRadarUI();
        }
        updateProfilePageButton();
    };

    // Register Tampermonkey / Violentmonkey / Torn PDA menu commands
    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('🔄 Check for Radar Updates', () => checkForScriptUpdates(true));
        GM_registerMenuCommand('🎯 Toggle Stakeout Radar Dock', () => {
            config.isMinimized = !config.isMinimized;
            saveConfig();
            renderRadarUI();
        });
        GM_registerMenuCommand('🔑 Set / Change Torn API Key', promptSetApiKey);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
