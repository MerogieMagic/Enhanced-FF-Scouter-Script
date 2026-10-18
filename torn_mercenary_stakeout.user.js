// ==UserScript==
// @name         Torn City - Mercenary Stakeout Radar
// @namespace    Violentmonkey Scripts
// @version      1.08
// @description  Precision mercenary target stakeout radar: live multi-target tracking for hospital discharge, online activity, flight landings, absolute HP, and instant audio alarms with 1-click attack staging.
// @author       Merogie & Antigravity
// @match        https://www.torn.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_notification
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_mercenary_stakeout.user.js
// @updateURL    https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_mercenary_stakeout.meta.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate execution
    if (window.__TORN_MERCENARY_STAKEOUT_LOADED__) return;
    window.__TORN_MERCENARY_STAKEOUT_LOADED__ = true;

    const SCRIPT_VERSION = "1.08";
    const SCRIPT_RAW_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_mercenary_stakeout.user.js";
    const SCRIPT_META_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_mercenary_stakeout.meta.js";

    // --- 1. TOAST NOTIFICATION & UPDATE ENGINE ---
    function showStakeoutToast(message) {
        try {
            const existing = document.getElementById('stakeout-toast');
            if (existing) existing.remove();

            const toast = document.createElement('div');
            toast.id = 'stakeout-toast';
            toast.innerHTML = `
                <span>${message}</span>
                <span id="stakeout-toast-close" style="cursor: pointer; margin-left: 8px; font-weight: bold; font-size: 16px; color: #94a3b8;">×</span>
            `;
            const closeBtn = toast.querySelector('#stakeout-toast-close');
            if (closeBtn) closeBtn.onclick = () => toast.remove();

            document.body.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
        } catch (e) {
            console.log('[Stakeout Toast]', message);
        }
    }

    function isNewerVersion(remote, local) {
        const rParts = String(remote).split('.').map(n => parseInt(n, 10) || 0);
        const lParts = String(local).split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(rParts.length, lParts.length);
        for (let i = 0; i < len; i++) {
            const r = rParts[i] || 0;
            const l = lParts[i] || 0;
            if (r > l) return true;
            if (r < l) return false;
        }
        return false;
    }

    function checkForScriptUpdates(manual = false) {
        if (manual) {
            showStakeoutToast('🔄 Checking GitHub for radar updates...');
        }

        const checkUrl = `${SCRIPT_META_URL}?t=${Date.now()}`;
        const handleResponseText = (responseText) => {
            try {
                const versionMatch = responseText.match(/@version\s+([0-9.]+)/);
                if (!versionMatch) {
                    if (manual) showStakeoutToast('⚠️ Could not parse remote version from GitHub.');
                    return;
                }
                const remoteVersion = versionMatch[1].trim();
                setStorage('last_update_check_time', Date.now());

                if (isNewerVersion(remoteVersion, SCRIPT_VERSION)) {
                    const confirmed = confirm(
                        `🎯 Torn City - Mercenary Stakeout Radar Update Available!\n\n` +
                        `Current Version: v${SCRIPT_VERSION}\n` +
                        `Latest Version:  v${remoteVersion}\n\n` +
                        `Click OK to open Tampermonkey/Violentmonkey installer and update now.`
                    );
                    if (confirmed) {
                        showStakeoutToast(`🚀 Opening v${remoteVersion} installer...`);
                        window.open(SCRIPT_RAW_URL, '_blank');
                    }
                } else {
                    if (manual) {
                        showStakeoutToast(`✅ You are using the latest version (v${SCRIPT_VERSION})!`);
                    }
                }
            } catch (e) {
                console.error('[Stakeout] Update check error:', e);
                if (manual) showStakeoutToast(`⚠️ Error checking updates: ${e.message}`);
            }
        };

        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: checkUrl,
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                },
                onload: function (res) {
                    if (res.status === 200 && res.responseText) {
                        handleResponseText(res.responseText);
                    } else {
                        if (manual) showStakeoutToast(`⚠️ Update check failed (HTTP ${res.status})`);
                    }
                },
                onerror: function (err) {
                    console.error('[Stakeout] GM_xmlhttpRequest error, trying fetch fallback:', err);
                    fetch(checkUrl, { cache: 'no-store' })
                        .then(r => r.text())
                        .then(handleResponseText)
                        .catch(() => {
                            if (manual) showStakeoutToast('⚠️ Network error while checking for updates.');
                        });
                }
            });
        } else {
            fetch(checkUrl, { cache: 'no-store' })
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.text();
                })
                .then(handleResponseText)
                .catch(err => {
                    console.error('[Stakeout] Fetch update error:', err);
                    if (manual) showStakeoutToast('⚠️ Network error while checking for updates.');
                });
        }
    }

    function autoCheckForUpdates() {
        try {
            const lastCheck = getStorage('last_update_check_time', 0);
            const now = Date.now();
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
            if (now - lastCheck > TWENTY_FOUR_HOURS) {
                checkForScriptUpdates(false);
            }
        } catch (e) {}
    }

    // --- 2. STORAGE & POLYFILLS ---
    function safeAddStyle(css) {
        try {
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(css);
            } else {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            }
        } catch (e) {
            console.error('[Stakeout] Style error:', e);
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

    function getCurrentUserId() {
        try {
            const input = document.getElementById('torn-user');
            if (input && input.value) {
                const parsed = JSON.parse(input.value);
                if (parsed && parsed.id) return String(parsed.id);
            }
        } catch (e) {}
        try {
            const sidebar = document.querySelector('a[href*="profiles.php?XID="]');
            const m = sidebar?.href?.match(/XID=(\d+)/);
            if (m) return m[1];
        } catch (e) {}
        return null;
    }

    function getApiKeyDetails() {
        const uid = getCurrentUserId();
        // 1. Account-specific key configured for stakeout
        if (uid) {
            const accStakeout = getStorage(`api_key_${uid}`, null);
            if (accStakeout && typeof accStakeout === 'string' && !accStakeout.startsWith('###')) {
                return { key: accStakeout.trim(), source: `Stakeout Custom (Acc ${uid})`, uid, isCustom: true };
            }
            const accLimited = getStorage(`limited_key_${uid}`, null);
            if (accLimited && typeof accLimited === 'string' && !accLimited.startsWith('###')) {
                return { key: accLimited.trim(), source: `Stakeout Limited (Acc ${uid})`, uid, isCustom: true };
            }
        }

        // 2. Global key configured for stakeout
        const globalStakeout = getStorage('api_key', null);
        if (globalStakeout && typeof globalStakeout === 'string' && !globalStakeout.startsWith('###')) {
            return { key: globalStakeout.trim(), source: 'Stakeout Global Key', uid, isCustom: true };
        }

        // 3. Inherit account-specific key from FF Scouter / TWSE
        if (uid) {
            const localAccKey = localStorage.getItem(`limited_key_${uid}`) || localStorage.getItem(`ff_twse_limited_key_${uid}`);
            if (localAccKey && typeof localAccKey === 'string' && !localAccKey.startsWith('###')) {
                return { key: localAccKey.trim(), source: `Inherited FF Scouter (Acc ${uid})`, uid, isCustom: false };
            }
        }

        // 4. Inherit global key from FF Scouter / TWSE / TornPDA
        const fallbackCandidates = [
            { k: getStorage('limited_key', null), name: 'Stakeout Limited Key' },
            { k: localStorage.getItem('twse-config-apikey'), name: 'Inherited TWSE Key' },
            { k: localStorage.getItem('limited_key'), name: 'Inherited FF Scouter Key' },
            { k: localStorage.getItem('torn_api_key'), name: 'Inherited Torn API Key' }
        ];
        for (const item of fallbackCandidates) {
            if (item.k && typeof item.k === 'string' && !item.k.startsWith('###')) {
                return { key: item.k.trim(), source: item.name, uid, isCustom: false };
            }
        }

        return { key: '', source: 'No API Key Found', uid, isCustom: false };
    }

    function getApiKey() {
        return getApiKeyDetails().key;
    }

    function maskApiKey(key) {
        if (!key || typeof key !== 'string') return 'Not Configured';
        if (key.length <= 8) return '••••••••';
        return `${key.slice(0, 4)}••••${key.slice(-4)}`;
    }

    function promptSetApiKey() {
        const uid = getCurrentUserId();
        const curDetails = getApiKeyDetails();
        const accountLabel = uid ? `Logged-in Account [${uid}]` : 'Global Profile';
        const msg = `🔑 Set Torn API Key for Mercenary Stakeout Radar\n\n` +
                    `Current Active: ${maskApiKey(curDetails.key)} (${curDetails.source})\n` +
                    `Target: ${accountLabel}\n\n` +
                    `Enter 16-character Torn API Key (Public, Minimal, Limited, or Full access):`;

        const input = prompt(msg, curDetails.key);
        if (input !== null) {
            const cleanKey = input.trim();
            if (uid) {
                setStorage(`api_key_${uid}`, cleanKey);
            }
            setStorage('api_key', cleanKey);
            showStakeoutToast(cleanKey ? `✅ API Key saved for ${accountLabel}!` : '⚠️ API Key removed.');
            renderRadarUI();
        }
    }

    // --- 2. CONFIGURATION & STATE ---
    const DEFAULT_CONFIG = {
        alertOnOkay: true,
        requireActive: true,        // ⚡ 2-Condition Rule: Target must be BOTH Okay and Active (Online / action <= 5m)
        activeThresholdMin: 5,      // 5 minutes
        alertOnNearHosp: true,      // ⚠️ Alert when hospital countdown drops to <= 5 minutes (stage attack)
        nearHospThresholdMin: 5,    // 5 minutes
        alertOnLanding: true,
        alertOnFullHp: false,
        soundAlarm: true,
        alarmVolume: 1.0,           // 0.1 to 1.0 (10% to 100%)
        alarmSoundType: 'siren',    // 'siren' (loudest) | 'horn' | 'klaxon' | 'chime'
        desktopNotif: true,
        autoOpenAttack: false,
        osAutoFocus: true,          // pings local focus companion on 127.0.0.1:8766
        rapidHospPolling: true,
        pollingInterval: 5, // seconds
        isPaused: false,
        isMinimized: false
    };

    let config = Object.assign({}, DEFAULT_CONFIG, getStorage('config', {}));
    function saveConfig() {
        setStorage('config', config);
    }

    let watchlist = getStorage('watchlist', []);
    if (!Array.isArray(watchlist)) watchlist = [];

    function saveWatchlist() {
        setStorage('watchlist', watchlist);
    }

    const targetsCache = {};
    const targetNearHospAlerted = {}; // tracks hospital release timestamps that already fired the <5m warning
    const callLog = [];

    function recordApiCall() {
        const now = Date.now();
        callLog.push(now);
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

    // --- 3. AUDIO ENGINE (Synthesized Web Audio API) ---
    let sharedAudioCtx = null;
    function getAudioCtx() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
                sharedAudioCtx = new AudioCtx();
            }
            if (sharedAudioCtx.state === 'suspended') {
                sharedAudioCtx.resume().catch(() => {});
            }
            return sharedAudioCtx;
        } catch (e) {
            return null;
        }
    }

    // Warm-up and unlock AudioContext on user interaction across Torn (capture phase)
    let audioUnlocked = false;
    function unlockAudioEngine() {
        try {
            const ctx = getAudioCtx();
            if (ctx) {
                if (ctx.state === 'suspended') {
                    ctx.resume().catch(() => {});
                }
                if (!audioUnlocked) {
                    // Play a 1-sample silent sound to satisfy browser autoplay policy
                    const buffer = ctx.createBuffer(1, 1, 22050);
                    const source = ctx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(ctx.destination);
                    source.start(0);
                    audioUnlocked = true;
                }
            }
        } catch (e) {}
    }
    ['click', 'keydown', 'touchstart', 'pointerdown', 'mousedown'].forEach(evt => {
        document.addEventListener(evt, unlockAudioEngine, { capture: true, passive: true });
        window.addEventListener(evt, unlockAudioEngine, { capture: true, passive: true });
    });

    // In-memory 8-bit PCM WAV synthesizer: 100% reliable HTML5 audio fallback if Web Audio is blocked
    function playPcmWavFallback(soundType = 'okay', durationMs = 1000, volume = 0.85) {
        try {
            const sampleRate = 8000;
            const numSamples = Math.floor(sampleRate * (durationMs / 1000));
            const buffer = new Uint8Array(44 + numSamples);
            const view = new DataView(buffer.buffer);
            const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i); };
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + numSamples, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);  // PCM
            view.setUint16(22, 1, true);  // Mono
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate, true);
            view.setUint16(32, 1, true);
            view.setUint16(34, 8, true);  // 8-bit
            writeStr(36, 'data');
            view.setUint32(40, numSamples, true);

            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate;
                let freq = 880;
                let gate = 1.0;

                if (soundType === 'warning') {
                    // Triple pulse (0.33s per cycle: 0.22s beep, 0.11s silent gap)
                    const cycle = t % 0.33;
                    gate = cycle < 0.22 ? 1.0 : 0.0;
                    freq = 1174.66;
                } else if (soundType === 'online') {
                    // Ascending notes: 0.0-0.25s (587Hz), 0.25-0.5s (880Hz), 0.5-1.0s (1174Hz)
                    if (t < 0.25) freq = 587.33;
                    else if (t < 0.5) freq = 880.00;
                    else freq = 1174.66;
                    gate = 1.0;
                } else {
                    // Siren alternating pitch (880Hz <-> 1760Hz every 0.2s)
                    freq = (Math.floor(t / 0.2) % 2 === 0) ? 1760 : 988;
                }

                const env = Math.min(1.0, (numSamples - i) / (sampleRate * 0.05));
                const val = (Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * gate;
                buffer[44 + i] = Math.floor(128 + (val * 120 * volume * env));
            }

            const blob = new Blob([buffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.volume = Math.max(0.1, Math.min(1.0, volume));
            audio.play().catch(() => {});
            setTimeout(() => URL.revokeObjectURL(url), durationMs + 1000);
        } catch (e) {
            console.error('[Stakeout] Audio fallback error:', e);
        }
    }

    // Universal navigation that works in desktop tabs and mobile Torn PDA WebViews
    function openTornUrl(url, makeActive = true) {
        try {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(url, { active: makeActive, insert: true, setParent: true });
                return;
            }
        } catch (e) {}
        try {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
        } catch (e) {}
        try {
            window.open(url, '_blank');
        } catch (e) {}
    }

    // Dynamic browser tab title pulsing to attract attention on taskbar
    let titleFlashTimer = null;
    let originalPageTitle = null;
    function startTitleFlash(text = 'TARGET OKAY - ATTACK!') {
        stopTitleFlash();
        originalPageTitle = document.title;
        let flag = false;
        titleFlashTimer = setInterval(() => {
            document.title = flag ? `🚨 [${text}]` : `⚔️ [READY - STAKEOUT RADAR]`;
            flag = !flag;
        }, 600);
        const clearOnFocus = () => {
            stopTitleFlash();
            window.removeEventListener('focus', clearOnFocus);
        };
        window.addEventListener('focus', clearOnFocus);
        setTimeout(() => stopTitleFlash(), 30000);
    }
    function stopTitleFlash() {
        if (titleFlashTimer) {
            clearInterval(titleFlashTimer);
            titleFlashTimer = null;
        }
        if (originalPageTitle) {
            document.title = originalPageTitle;
            originalPageTitle = null;
        }
    }

    // Signals local Windows companion bridge on 127.0.0.1:8766 to bring browser window to absolute front
    function triggerOsAutoFocus() {
        if (!config.osAutoFocus) return;
        try {
            fetch('http://127.0.0.1:8766/focus', { mode: 'no-cors' }).catch(() => {});
        } catch (e) {}
    }

    // High-Volume Procedural Web Audio Engine with Piercing Multi-Harmonic Profiles
    function playStakeoutAlarm(type = 'okay') {
        if (!config.soundAlarm) return;
        const vol = Math.max(0.1, Math.min(1.0, config.alarmVolume ?? 1.0));

        // Always attempt resume if suspended
        const ctx = getAudioCtx();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        // If Web Audio is not running (e.g. suspended in background tab), IMMEDIATELY play PCM WAV fallback
        if (!ctx || ctx.state !== 'running') {
            playPcmWavFallback(type, type === 'warning' ? 1000 : (type === 'online' ? 800 : 1200), vol);
        }

        try {
            if (!ctx) return;

            const soundType = config.alarmSoundType || 'siren';

            if (type === 'okay' || type === 'test') {
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.85 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                if (soundType === 'siren') {
                    // Emergency Dual-Tone Klaxon (Ultra-Loud, Piercing Sawtooth+Square Stack)
                    // 3 rapid alternating high-frequency cycles (880Hz <-> 1760Hz) over 1.2s
                    for (let cycle = 0; cycle < 3; cycle++) {
                        const t0 = ctx.currentTime + (cycle * 0.4);
                        // High pitch pulse
                        const osc1a = ctx.createOscillator();
                        const osc1b = ctx.createOscillator();
                        const g1 = ctx.createGain();
                        osc1a.type = 'sawtooth';
                        osc1b.type = 'square';
                        osc1a.frequency.setValueAtTime(1760, t0);
                        osc1b.frequency.setValueAtTime(1760, t0);
                        g1.gain.setValueAtTime(0.5, t0);
                        g1.gain.exponentialRampToValueAtTime(0.01, t0 + 0.18);
                        osc1a.connect(g1);
                        osc1b.connect(g1);
                        g1.connect(masterGain);
                        osc1a.start(t0);
                        osc1b.start(t0);
                        osc1a.stop(t0 + 0.18);
                        osc1b.stop(t0 + 0.18);

                        // Low pitch response
                        const osc2a = ctx.createOscillator();
                        const osc2b = ctx.createOscillator();
                        const g2 = ctx.createGain();
                        osc2a.type = 'sawtooth';
                        osc2b.type = 'square';
                        osc2a.frequency.setValueAtTime(988, t0 + 0.2);
                        osc2b.frequency.setValueAtTime(988, t0 + 0.2);
                        g2.gain.setValueAtTime(0.5, t0 + 0.2);
                        g2.gain.exponentialRampToValueAtTime(0.01, t0 + 0.38);
                        osc2a.connect(g2);
                        osc2b.connect(g2);
                        g2.connect(masterGain);
                        osc2a.start(t0 + 0.2);
                        osc2b.start(t0 + 0.2);
                        osc2a.stop(t0 + 0.38);
                        osc2b.stop(t0 + 0.38);
                    }
                } else if (soundType === 'horn') {
                    // Tactical Air Horn (Triad Chord Blast: 440Hz + 554.37Hz + 659.25Hz)
                    // 2 heavy blasts: blast 1 (0.32s), pause (0.1s), blast 2 (0.48s)
                    const blasts = [
                        { start: ctx.currentTime, dur: 0.32 },
                        { start: ctx.currentTime + 0.42, dur: 0.48 }
                    ];
                    blasts.forEach(b => {
                        [440, 554.37, 659.25].forEach(freq => {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = 'sawtooth';
                            osc.frequency.setValueAtTime(freq, b.start);
                            g.gain.setValueAtTime(0.33, b.start);
                            g.gain.exponentialRampToValueAtTime(0.01, b.start + b.dur);
                            osc.connect(g);
                            g.connect(masterGain);
                            osc.start(b.start);
                            osc.stop(b.start + b.dur);
                        });
                    });
                } else if (soundType === 'klaxon') {
                    // Heavy War Alarm Pulse: 2 rising/falling pitch sweeps (587Hz -> 1174Hz -> 587Hz)
                    for (let i = 0; i < 2; i++) {
                        const t0 = ctx.currentTime + (i * 0.55);
                        const osc = ctx.createOscillator();
                        const g = ctx.createGain();
                        osc.type = 'sawtooth';
                        osc.frequency.setValueAtTime(587.33, t0);
                        osc.frequency.linearRampToValueAtTime(1174.66, t0 + 0.25);
                        osc.frequency.linearRampToValueAtTime(587.33, t0 + 0.5);
                        g.gain.setValueAtTime(0.8, t0);
                        g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.5);
                        osc.connect(g);
                        g.connect(masterGain);
                        osc.start(t0);
                        osc.stop(t0 + 0.5);
                    }
                } else {
                    // Bright High Chime (1046.5Hz -> 1568Hz)
                    const t0 = ctx.currentTime;
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const g1 = ctx.createGain();
                    const g2 = ctx.createGain();
                    osc1.type = 'sine';
                    osc2.type = 'triangle';
                    osc1.frequency.setValueAtTime(1046.5, t0);
                    osc2.frequency.setValueAtTime(1567.98, t0 + 0.18);
                    g1.gain.setValueAtTime(0.7, t0);
                    g1.gain.exponentialRampToValueAtTime(0.01, t0 + 0.5);
                    g2.gain.setValueAtTime(0.8, t0 + 0.18);
                    g2.gain.exponentialRampToValueAtTime(0.01, t0 + 0.7);
                    osc1.connect(g1);
                    osc2.connect(g2);
                    g1.connect(masterGain);
                    g2.connect(masterGain);
                    osc1.start(t0);
                    osc2.start(t0 + 0.18);
                    osc1.stop(t0 + 0.5);
                    osc2.stop(t0 + 0.7);
                }
            } else if (type === 'warning') {
                // Hospital Countdown < 5 Mins Warning (Urgent Triple Staccato Pulse: 1046Hz & 1318Hz, 1.0s)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.85 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                for (let i = 0; i < 3; i++) {
                    const t0 = ctx.currentTime + (i * 0.32);
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
            } else if (type === 'online') {
                // Target Online / Active (Loud 3-Note Ascending Fanfare: 587Hz -> 880Hz -> 1174Hz, 0.8s)
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(0.85 * vol, ctx.currentTime);
                masterGain.connect(ctx.destination);

                const notes = [
                    { f: 587.33, t: 0, d: 0.18 },   // D5
                    { f: 880.00, t: 0.18, d: 0.18 }, // A5
                    { f: 1174.66, t: 0.36, d: 0.44 } // D6
                ];
                notes.forEach(n => {
                    const t0 = ctx.currentTime + n.t;
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc1.type = 'sawtooth';
                    osc2.type = 'square';
                    osc1.frequency.setValueAtTime(n.f, t0);
                    osc2.frequency.setValueAtTime(n.f, t0);
                    g.gain.setValueAtTime(0.5, t0);
                    g.gain.exponentialRampToValueAtTime(0.01, t0 + n.d);
                    osc1.connect(g);
                    osc2.connect(g);
                    g.connect(masterGain);
                    osc1.start(t0);
                    osc2.start(t0);
                    osc1.stop(t0 + n.d);
                    osc2.stop(t0 + n.d);
                });
            }
        } catch (e) {
            console.error('[Stakeout] Audio error, falling back to PCM WAV:', e);
            playPcmWavFallback(type === 'warning' ? 1046 : 880, 800, vol);
        }
    }

    // --- 4. DESKTOP NOTIFICATIONS & WINDOW FOCUS ---
    function sendStakeoutNotification(title, body, url) {
        if (!config.desktopNotif) return;
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    title: `🎯 Stakeout: ${title}`,
                    text: body,
                    image: 'https://www.torn.com/favicon.ico',
                    highlight: true,
                    timeout: 20000,
                    onclick: () => {
                        window.focus();
                        if (url) openTornUrl(url, true);
                    }
                });
                return;
            }
        } catch (e) {}
        try {
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    const notif = new Notification(`🎯 Stakeout: ${title}`, {
                        body: body,
                        icon: 'https://www.torn.com/favicon.ico',
                        requireInteraction: true,
                        silent: true
                    });
                    notif.onclick = () => {
                        window.focus();
                        if (url) openTornUrl(url, true);
                        try { notif.close(); } catch (e) {}
                    };
                } else if (Notification.permission !== 'denied') {
                    Notification.requestPermission();
                }
            }
        } catch (e) {}
    }

    // --- 5. TORN API POLLER & TELEMETRY ---
    async function fetchTargetTelemetry(targetId) {
        const apiKey = getApiKey();
        if (!apiKey) return null;

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
                if (data.error.code === 2) {
                    showStakeoutToast('⚠️ Invalid Torn API Key! Click ⚙ in Radar to update.');
                }
                return { error: data.error.error || 'API Error', code: data.error.code };
            }
            return data;
        } catch (e) {
            console.error('[Stakeout] Network error:', e);
            return null;
        }
    }

    // --- 6. TRIGGER EVALUATION & ATTACK STAGING ENGINE ---
    const lastAttackTabOpened = {};
    function triggerAutoAttackOpen(targetId) {
        if (!config.autoOpenAttack) return;
        const now = Date.now();
        if (lastAttackTabOpened[targetId] && now - lastAttackTabOpened[targetId] < 30000) {
            return;
        }
        lastAttackTabOpened[targetId] = now;
        try {
            const attackUrl = `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`;
            openTornUrl(attackUrl, true);
            window.focus();
            triggerOsAutoFocus();
            showStakeoutToast(`⚔️ Auto-opened attack tab for [${targetId}] (Online & Okay)!`);
        } catch (e) {
            console.error('[Stakeout] Auto attack popup error:', e);
        }
    }

    // Helper predicates for the 2-Condition Rule:
    // 1. Target must be Okay and ready (attackable)
    // 2. Target must be Online or have last action within 5 minutes
    function isTargetActiveWithin5Min(snapshot, nowSec = Math.floor(Date.now() / 1000)) {
        if (!snapshot) return false;
        if (snapshot.online === 'Online') return true;

        if (snapshot.lastActionTs > 0) {
            const ageSec = nowSec - snapshot.lastActionTs;
            if (ageSec >= 0 && ageSec <= (config.activeThresholdMin || 5) * 60) return true;
        }

        const rel = (snapshot.lastActionRel || '').toLowerCase();
        if (rel.includes('just now') || rel.includes('right now') || rel.includes('moment ago')) return true;
        const m = rel.match(/(\d+)\s*(?:minute|min)/);
        if (m) {
            const mins = parseInt(m[1], 10);
            if (mins <= (config.activeThresholdMin || 5)) return true;
        }
        const s = rel.match(/(\d+)\s*(?:second|sec)/);
        if (s) return true;

        return false;
    }

    function isTargetAttackReady(snapshot) {
        if (!snapshot) return false;
        return snapshot.state === 'Okay';
    }

    function isTargetReadyAndActive(snapshot, nowSec = Math.floor(Date.now() / 1000)) {
        if (!isTargetAttackReady(snapshot)) return false;
        if (config.requireActive === false) return true;
        return isTargetActiveWithin5Min(snapshot, nowSec);
    }

    function isTargetNearHospAndActive(snapshot, nowSec = Math.floor(Date.now() / 1000), thresholdMin = 5) {
        if (!snapshot || snapshot.state !== 'Hospital') return false;
        if (snapshot.until <= nowSec) return false;
        const remainingSec = snapshot.until - nowSec;
        const thresholdSec = thresholdMin * 60;
        if (remainingSec > thresholdSec) return false;
        if (config.requireActive === false) return true;
        return isTargetActiveWithin5Min(snapshot, nowSec);
    }

    function evaluateTargetTriggers(targetId, freshData) {
        if (!freshData || freshData.error) return;

        const currentSnapshot = {
            name: freshData.name || `Player [${targetId}]`,
            state: freshData.status?.state || 'Okay',
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

        const isNowReadyAndActive = isTargetReadyAndActive(currentSnapshot, nowSec);
        const wasReadyAndActive = previous ? isTargetReadyAndActive(previous, nowSec) : false;
        const isCurrentActive = isTargetActiveWithin5Min(currentSnapshot, nowSec);

        // --- 1. HOSPITAL COUNTDOWN <= 5 MINS ALERT (Pre-Stage Attack Window) ---
        // Fires if target is in hospital with <= 5m remaining AND is active within 5m
        if (config.alertOnNearHosp && currentSnapshot.state === 'Hospital' && currentSnapshot.until > nowSec) {
            const remainingSec = currentSnapshot.until - nowSec;
            const thresholdSec = (config.nearHospThresholdMin || 5) * 60;
            const satisfiesActivity = (config.requireActive === false) || isCurrentActive;

            if (remainingSec <= thresholdSec && satisfiesActivity && targetNearHospAlerted[targetId] !== currentSnapshot.until) {
                targetNearHospAlerted[targetId] = currentSnapshot.until;
                playStakeoutAlarm('warning');
                const minLeft = Math.max(1, Math.ceil(remainingSec / 60));
                startTitleFlash(`${currentSnapshot.name} HOSP < ${minLeft}M!`);
                sendStakeoutNotification(
                    `⚠️ ${currentSnapshot.name} Hospital < 5 Mins!`,
                    `Release in ~${minLeft}m (${remainingSec}s). Target is active (${currentSnapshot.online})! Pre-stage attack.`,
                    `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`
                );
                window.focus();
                triggerOsAutoFocus();
                showStakeoutToast(`⚠️ Target [${currentSnapshot.name}] hospital release in ~${minLeft}m (${remainingSec}s) & active! Stage attack.`);
            }
        }

        // Reset near-hosp alert tracker if target leaves hospital
        if (currentSnapshot.state !== 'Hospital' || currentSnapshot.until <= nowSec) {
            delete targetNearHospAlerted[targetId];
        }

        if (previous) {
            // --- 2. MAIN ATTACK ALARM: TARGET BECAME OKAY & ACTIVE (2-Condition Rule) ---
            // Triggers when target transitions into satisfying BOTH:
            // Condition 1: Target is Okay and ready
            // Condition 2: Target is Online or last action within 5 mins
            const becameReadyAndActive = !wasReadyAndActive && isNowReadyAndActive;

            if (config.alertOnOkay && becameReadyAndActive) {
                playStakeoutAlarm('okay');
                startTitleFlash(`${currentSnapshot.name} READY (ACTIVE)!`);
                sendStakeoutNotification(
                    `⚔️ ${currentSnapshot.name} is OKAY & ACTIVE!`,
                    `Target is attackable (Okay) and active (${currentSnapshot.online}, ${currentSnapshot.lastActionRel || 'within 5m'})! Click to launch attack.`,
                    `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`
                );
                window.focus();
                triggerOsAutoFocus();
                showStakeoutToast(`⚔️ Target [${currentSnapshot.name}] is OKAY & ACTIVE (${currentSnapshot.online}, ${currentSnapshot.lastActionRel || 'within 5m'})! Attack now.`);

                // Auto-open attack tab if enabled
                if (config.autoOpenAttack) {
                    triggerAutoAttackOpen(targetId);
                }
            }

            // --- 3. FLIGHT LANDING (while active) ---
            if (config.alertOnLanding && previous.state === 'Traveling' && currentSnapshot.state !== 'Traveling') {
                if (!becameReadyAndActive) {
                    const satisfiesActivity = (config.requireActive === false) || isCurrentActive;
                    if (satisfiesActivity && currentSnapshot.state === 'Okay') {
                        playStakeoutAlarm('okay');
                        startTitleFlash(`${currentSnapshot.name} LANDED!`);
                        sendStakeoutNotification(
                            `${currentSnapshot.name} LANDED!`,
                            `Flight arrived: now ${currentSnapshot.state} (${currentSnapshot.desc}) • Active: ${currentSnapshot.online}`,
                            `https://www.torn.com/profiles.php?XID=${targetId}`
                        );
                        window.focus();
                        triggerOsAutoFocus();
                        if (config.autoOpenAttack) {
                            triggerAutoAttackOpen(targetId);
                        }
                    }
                }
            }

            // --- 4. FULL HP (while active) ---
            if (config.alertOnFullHp && previous.hpPct < 100 && currentSnapshot.hpPct >= 100) {
                const satisfiesActivity = (config.requireActive === false) || isCurrentActive;
                if (satisfiesActivity && currentSnapshot.state === 'Okay') {
                    playStakeoutAlarm('online');
                    startTitleFlash(`${currentSnapshot.name} 100% HP!`);
                    sendStakeoutNotification(
                        `${currentSnapshot.name} reached 100% HP!`,
                        `Life fully recovered: ${currentSnapshot.hpCurr.toLocaleString()} / ${currentSnapshot.hpMax.toLocaleString()}`,
                        `https://www.torn.com/page.php?sid=attack&user2ID=${targetId}`
                    );
                    window.focus();
                    triggerOsAutoFocus();
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

    // --- 7. STYLES ---
    safeAddStyle(`
        #torn-mercenary-dock,
        #torn-stakeout-dock {
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            z-index: 9999999 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            user-select: none;
        }

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
        .stakeout-card.near-ready {
            border-color: #f59e0b;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.35);
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, #1e293b 100%);
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
        .stakeout-status-pill.okay-offline {
            background: rgba(100, 116, 139, 0.25);
            border: 1px solid #64748b;
            color: #cbd5e1;
        }
        .stakeout-status-pill.hospital {
            background: rgba(239, 68, 68, 0.25);
            border: 1px solid #ef4444;
            color: #fca5a5;
        }
        .stakeout-status-pill.hospital.near-ready {
            background: rgba(245, 158, 11, 0.3) !important;
            border: 1px solid #f59e0b !important;
            color: #fef08a !important;
            animation: stakeoutPillPulse 1.2s infinite ease-in-out;
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
        .stakeout-attack-btn.stage-ready {
            background: #b45309;
            border-color: #f59e0b;
            color: #fef08a !important;
            animation: stakeoutPillPulse 1.4s infinite ease-in-out;
        }
        .stakeout-attack-btn.stage-ready:hover {
            background: #d97706;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
        }

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

        .stakeout-profile-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            background: rgba(30, 41, 59, 0.85) !important;
            border: 1px solid #3b82f6 !important;
            color: #93c5fd !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            cursor: pointer !important;
            margin: 0 !important;
            line-height: 1.2 !important;
            transition: all 0.15s ease !important;
            text-transform: none !important;
            letter-spacing: normal !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
        }
        .stakeout-profile-btn:hover {
            background: #2563eb !important;
            color: #ffffff !important;
            border-color: #60a5fa !important;
        }
        .stakeout-profile-btn.active {
            background: rgba(22, 101, 52, 0.85) !important;
            border-color: #22c55e !important;
            color: #86efac !important;
        }

        #stakeout-toast {
            position: fixed;
            bottom: 75px;
            right: 20px;
            background: #0f172a;
            border: 1px solid #38bdf8;
            color: #f8fafc;
            padding: 9px 15px;
            border-radius: 8px;
            font-size: 12.5px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: stakeoutToastFadeIn 0.2s ease-out;
        }
        @keyframes stakeoutToastFadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `);

    // --- 8. UI BUILDER & DOCK ---
    let dockRoot = null;

    function renderRadarUI() {
        if (!document.body) return;

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
            const toggleEl = document.getElementById('stakeout-pill-toggle');
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
                    <label class="stakeout-toggle-row" title="Requires target to meet 2 conditions: Okay & ready, AND Online or last action within 5 mins">
                        <span>⚔️ Alert on Okay & Active (&le; 5m)</span>
                        <input type="checkbox" id="toggle-alert-okay" ${config.alertOnOkay ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row" title="Enforces that all attack alarms require target to be Online or have last action within 5 minutes">
                        <span>⚡ Require Target Active (&le; 5 Mins)</span>
                        <input type="checkbox" id="toggle-require-active" ${config.requireActive !== false ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row" title="Alerts when target has 5 minutes or less remaining in hospital and is active so you can pre-stage attack">
                        <span>⚠️ Alert on Hospital &lt; 5 Mins (Active)</span>
                        <input type="checkbox" id="toggle-alert-nearhosp" ${config.alertOnNearHosp ? 'checked' : ''} />
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
                        <span>Audio Sound Alarm</span>
                        <input type="checkbox" id="toggle-sound-alarm" ${config.soundAlarm ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>🔊 Alarm Volume</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="range" id="stakeout-vol-slider" min="10" max="100" value="${Math.round((config.alarmVolume ?? 1.0) * 100)}" style="width: 80px; cursor: pointer; accent-color: #38bdf8;" />
                            <span id="stakeout-vol-label" style="font-size: 11px; font-family: monospace; min-width: 32px; text-align: right; color: #38bdf8;">${Math.round((config.alarmVolume ?? 1.0) * 100)}%</span>
                        </div>
                    </label>
                    <label class="stakeout-toggle-row">
                        <span>🎵 Sound Profile</span>
                        <select id="stakeout-sound-select" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 11px; cursor: pointer;">
                            <option value="siren" ${(config.alarmSoundType || 'siren') === 'siren' ? 'selected' : ''}>🚨 Emergency Siren (Loudest)</option>
                            <option value="horn" ${(config.alarmSoundType || 'siren') === 'horn' ? 'selected' : ''}>📯 Tactical Air Horn</option>
                            <option value="klaxon" ${(config.alarmSoundType || 'siren') === 'klaxon' ? 'selected' : ''}>⚠️ Heavy Klaxon</option>
                            <option value="chime" ${(config.alarmSoundType || 'siren') === 'chime' ? 'selected' : ''}>🔔 Bright Chime</option>
                        </select>
                    </label>
                    <label class="stakeout-toggle-row" title="Persistent desktop banner pinned on screen over other apps until clicked">
                        <span>Desktop Notification (Persistent)</span>
                        <input type="checkbox" id="toggle-desktop-notif" ${config.desktopNotif ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row" title="Automatically opens the pre-staged attack tab in an active tab when target is both Active (Online/Idle) and Attackable (Okay)">
                        <span>Auto-Open Attack Tab (Online & Okay)</span>
                        <input type="checkbox" id="toggle-auto-attack" ${config.autoOpenAttack ? 'checked' : ''} />
                    </label>
                    <label class="stakeout-toggle-row" title="Pings local companion bridge on 127.0.0.1:8766 to bring browser window to the front over other apps">
                        <span>⚡ OS Auto-Focus (Companion Bridge)</span>
                        <input type="checkbox" id="toggle-os-autofocus" ${config.osAutoFocus ? 'checked' : ''} />
                    </label>

                    <div style="border-top: 1px solid #334155; margin-top: 4px; padding-top: 6px;">
                        <div style="font-weight: 800; color: #f8fafc; margin-bottom: 4px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
                            <span>🔑 Torn API Key</span>
                            <button class="stakeout-btn-icon" id="stakeout-btn-set-key" style="padding: 2px 8px; font-size: 10px; border-color: #38bdf8; color: #38bdf8;" title="Configure Torn API Key">Change Key</button>
                        </div>
                        <div style="font-size: 10.5px; color: #94a3b8; line-height: 1.4;">
                            <div>Active: <strong style="color: ${keyDetails.key ? '#38bdf8' : '#ef4444'}; font-family: monospace;">${maskApiKey(keyDetails.key)}</strong></div>
                            <div>Source: <span style="color: #cbd5e1;">${keyDetails.source}</span></div>
                            ${keyDetails.uid ? `<div style="color: #64748b;">Logged-in User ID: [${keyDetails.uid}]</div>` : ''}
                        </div>
                    </div>

                    <div style="display: flex; gap: 6px; margin-top: 4px;">
                        <button class="stakeout-btn-icon" id="stakeout-btn-test-sound" style="flex: 1; padding: 5px;" title="Test Synthesized Alarm Sound">🔊 Test Sound</button>
                        <button class="stakeout-btn-icon" id="stakeout-btn-check-update" style="flex: 1; padding: 5px; border-color: #38bdf8; color: #38bdf8;" title="Check GitHub for Script Updates">🔄 Check Updates</button>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 2px;">
                        <span>Radar v${SCRIPT_VERSION}</span>
                        <span>Rate: ${callRate}/90 cpm • Poll: ${config.pollingInterval}s</span>
                    </div>
                </div>

                <div class="stakeout-list" id="stakeout-target-list">
                    ${watchlist.length === 0 ? `<div class="stakeout-empty">${!keyDetails.key ? '<span style="color: #f87171; font-weight: 700;">⚠️ API Key Missing!</span><br>Click ⚙ (Settings) &gt; "Change Key" to start scanning.<br><br>' : ''}No targets on watchlist.<br>Add an ID above or click "🎯 Stakeout" on any profile!</div>` : ''}
                </div>
            </div>
        `;

        const minBtn = document.getElementById('stakeout-btn-minimize');
        if (minBtn) {
            minBtn.onclick = () => {
                config.isMinimized = true;
                saveConfig();
                renderRadarUI();
            };
        }

        const pauseBtn = document.getElementById('stakeout-btn-pause');
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                config.isPaused = !config.isPaused;
                saveConfig();
                renderRadarUI();
            };
        }

        const settingsPanel = document.getElementById('stakeout-settings-panel');
        const settingsBtn = document.getElementById('stakeout-btn-settings');
        if (settingsBtn && settingsPanel) {
            settingsBtn.onclick = () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
            };
        }

        const tOkay = document.getElementById('toggle-alert-okay');
        if (tOkay) tOkay.onchange = (e) => { config.alertOnOkay = e.target.checked; saveConfig(); };

        const tReqActive = document.getElementById('toggle-require-active');
        if (tReqActive) tReqActive.onchange = (e) => { config.requireActive = e.target.checked; saveConfig(); };

        const tNearHosp = document.getElementById('toggle-alert-nearhosp');
        if (tNearHosp) tNearHosp.onchange = (e) => { config.alertOnNearHosp = e.target.checked; saveConfig(); };

        const tLanding = document.getElementById('toggle-alert-landing');
        if (tLanding) tLanding.onchange = (e) => { config.alertOnLanding = e.target.checked; saveConfig(); };

        const tFullHp = document.getElementById('toggle-alert-fullhp');
        if (tFullHp) tFullHp.onchange = (e) => { config.alertOnFullHp = e.target.checked; saveConfig(); };

        const tSound = document.getElementById('toggle-sound-alarm');
        if (tSound) tSound.onchange = (e) => { config.soundAlarm = e.target.checked; saveConfig(); };

        const volSlider = document.getElementById('stakeout-vol-slider');
        const volLabel = document.getElementById('stakeout-vol-label');
        if (volSlider) {
            volSlider.oninput = (e) => {
                const val = parseInt(e.target.value, 10) || 100;
                config.alarmVolume = val / 100;
                if (volLabel) volLabel.textContent = `${val}%`;
            };
            volSlider.onchange = () => saveConfig();
        }

        const soundSelect = document.getElementById('stakeout-sound-select');
        if (soundSelect) {
            soundSelect.onchange = (e) => {
                config.alarmSoundType = e.target.value;
                saveConfig();
                playStakeoutAlarm('test');
            };
        }

        const tNotif = document.getElementById('toggle-desktop-notif');
        if (tNotif) {
            tNotif.onchange = (e) => {
                config.desktopNotif = e.target.checked;
                saveConfig();
                if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
                    Notification.requestPermission();
                }
            };
        }

        const tAutoAttack = document.getElementById('toggle-auto-attack');
        if (tAutoAttack) tAutoAttack.onchange = (e) => { config.autoOpenAttack = e.target.checked; saveConfig(); };

        const tOsFocus = document.getElementById('toggle-os-autofocus');
        if (tOsFocus) {
            tOsFocus.onchange = (e) => {
                config.osAutoFocus = e.target.checked;
                saveConfig();
            };
        }

        const testSoundBtn = document.getElementById('stakeout-btn-test-sound');
        if (testSoundBtn) testSoundBtn.onclick = () => playStakeoutAlarm('test');

        const checkUpdateBtn = document.getElementById('stakeout-btn-check-update');
        if (checkUpdateBtn) checkUpdateBtn.onclick = () => checkForScriptUpdates(true);

        const setKeyBtn = document.getElementById('stakeout-btn-set-key');
        if (setKeyBtn) setKeyBtn.onclick = promptSetApiKey;

        const inputEl = document.getElementById('stakeout-input-target');
        const addBtn = document.getElementById('stakeout-btn-add');
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
                alert('Please enter a valid Torn Player ID or Profile URL.');
            }
        };

        if (addBtn) addBtn.onclick = handleAdd;
        if (inputEl) inputEl.onkeydown = (e) => { if (e.key === 'Enter') handleAdd(); };

        const listContainer = document.getElementById('stakeout-target-list');
        if (listContainer) {
            watchlist.forEach(id => {
                const card = document.createElement('div');
                card.id = `stakeout-card-${id}`;
                card.className = 'stakeout-card';
                listContainer.appendChild(card);
                updateTargetCardUI(id);
            });
        }
    }

    function updateRadarBadge() {
        if (!config.isMinimized) return;
        renderRadarUI();
    }

    function formatCountdown(sec) {
        if (sec <= 0) return 'Ready';
        if (sec < 60) return `${sec}s`;
        const totalMin = Math.floor(sec / 60);
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    function updateTargetCardUI(targetId) {
        const card = document.getElementById(`stakeout-card-${targetId}`);
        if (!card) return;

        const info = targetsCache[targetId];
        if (!info || !info.data) {
            const emptyHtml = `
                <div class="stakeout-card-header">
                    <span class="stakeout-card-name">🎯 Target [${targetId}]</span>
                    <button class="stakeout-btn-icon" data-del="${targetId}">✕</button>
                </div>
                <div style="font-size: 11px; color: #94a3b8;">Scanning telemetry...</div>
            `;
            if (card.dataset.lastStateKey !== `pending_${targetId}`) {
                card.dataset.lastStateKey = `pending_${targetId}`;
                card.innerHTML = emptyHtml;
                const delBtn = card.querySelector(`[data-del="${targetId}"]`);
                if (delBtn) delBtn.onclick = () => removeTarget(targetId);
            }
            return;
        }

        const d = info.data;
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = d.until > nowSec ? d.until - nowSec : 0;
        const isOkay = d.state === 'Okay';
        const formattedTime = formatCountdown(remainingSec);
        const exactTooltip = remainingSec > 0
            ? `${Math.floor(remainingSec / 3600)}h ${Math.floor((remainingSec % 3600) / 60)}m ${remainingSec % 60}s`
            : 'Ready';

        const stateKey = `${d.state}_${formattedTime}_${d.hpCurr}_${d.hpMax}_${d.online}`;
        if (card.dataset.lastStateKey === stateKey) return;
        card.dataset.lastStateKey = stateKey;

        const isReadyAndActive = isTargetReadyAndActive(d, nowSec);
        const isNearHospAndActive = isTargetNearHospAndActive(d, nowSec, config.nearHospThresholdMin || 5);
        const isActive = isTargetActiveWithin5Min(d, nowSec);

        card.className = `stakeout-card ${isReadyAndActive ? 'ready' : (isNearHospAndActive ? 'near-ready' : '')}`;

        let statusBadge = '';
        if (d.state === 'Hospital') {
            if (isNearHospAndActive) {
                statusBadge = `<span class="stakeout-status-pill hospital near-ready" title="Pre-stage attack! Exact remaining: ${exactTooltip}">⚠️ STAGE! Hosp: ${formattedTime}</span>`;
            } else {
                statusBadge = `<span class="stakeout-status-pill hospital" title="Exact remaining: ${exactTooltip}">🏥 Hosp: ${formattedTime}</span>`;
            }
        } else if (d.state === 'Traveling') {
            statusBadge = `<span class="stakeout-status-pill traveling" title="Exact remaining: ${exactTooltip}">✈️ ${d.desc || 'Traveling'} (${formattedTime})</span>`;
        } else if (d.state === 'Abroad') {
            statusBadge = `<span class="stakeout-status-pill abroad">🌍 ${d.desc || 'Abroad'}</span>`;
        } else if (d.state === 'Jail') {
            statusBadge = `<span class="stakeout-status-pill hospital" title="Exact remaining: ${exactTooltip}">🚔 Jail: ${formattedTime}</span>`;
        } else {
            if (isActive) {
                statusBadge = `<span class="stakeout-status-pill okay" title="Target is attackable (Okay) and active!">⚡ OKAY & ACTIVE!</span>`;
            } else {
                statusBadge = `<span class="stakeout-status-pill okay-offline" title="Target is Okay, but last action was > 5 mins ago">💤 Okay (Offline)</span>`;
            }
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

            <a href="https://www.torn.com/page.php?sid=attack&user2ID=${targetId}" target="_blank" class="stakeout-attack-btn ${isReadyAndActive ? 'ready' : (isNearHospAndActive ? 'stage-ready' : '')}">
                <span>⚔️ ATTACK TARGET</span>
                ${isReadyAndActive ? '<span>⚡ (READY & ACTIVE!)</span>' : (isNearHospAndActive ? `<span>⚠️ (STAGE ~${Math.max(1, Math.ceil(remainingSec / 60))}M)</span>` : (isOkay ? '<span style="font-size: 10px; opacity: 0.85;">(Inactive)</span>' : ''))}
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

    // --- 9. PROFILE PAGE QUICK STAKEOUT BUTTON (Safe, Non-Looping) ---
    function updateProfilePageButton() {
        if (!window.location.href.includes('profiles.php')) return;
        const match = window.location.href.match(/XID=(\d+)/);
        if (!match) return;
        const profileId = match[1];

        const isWatched = watchlist.includes(profileId);
        let btn = document.getElementById('stakeout-profile-action-btn');

        // If btn was previously inserted directly into .profile-right-wrapper (causing distortion), remove it
        if (btn && btn.parentElement && btn.parentElement.classList.contains('profile-right-wrapper')) {
            btn.remove();
            btn = null;
        }

        if (!btn) {
            // Priority 1: Inside the "Actions" header bar (aligned right, 0px vertical footprint)
            const actionsHeader = document.querySelector(
                '.profile-right-wrapper .title-black, .profile-right-wrapper .title, .profile-right-wrapper h4, .profile-right-wrapper [class*="title"], [class*="actions"] .title-black, [class*="actions"] h4'
            );

            if (actionsHeader) {
                btn = document.createElement('button');
                btn.id = 'stakeout-profile-action-btn';
                btn.className = 'stakeout-profile-btn';
                
                // Style actionsHeader as flex container so Actions stays left and button floats right
                actionsHeader.style.display = 'flex';
                actionsHeader.style.justifyContent = 'space-between';
                actionsHeader.style.alignItems = 'center';
                actionsHeader.appendChild(btn);
            } else {
                // Priority 2: Inside the top links wrap or profile title bar (no column distortion)
                const topContainer = document.querySelector('.links-top-wrap, .user-information .title-black, .user-information h4');
                if (!topContainer) return;

                btn = document.createElement('button');
                btn.id = 'stakeout-profile-action-btn';
                btn.className = 'stakeout-profile-btn';
                topContainer.appendChild(btn);
            }
        }

        const newText = isWatched ? `🎯 In Radar (Remove)` : `🎯 + Stakeout`;
        const newTitle = isWatched ? `Target [${profileId}] is in Stakeout Radar. Click to remove.` : `Click to add target [${profileId}] to Stakeout Radar.`;
        const newClass = `stakeout-profile-btn ${isWatched ? 'active' : ''}`;

        if (btn.textContent !== newText) btn.textContent = newText;
        if (btn.className !== newClass) btn.className = newClass;
        if (btn.title !== newTitle) btn.title = newTitle;

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (watchlist.includes(profileId)) {
                removeTarget(profileId);
            } else {
                watchlist.push(profileId);
                saveWatchlist();
                renderRadarUI();
                pollSingleTarget(profileId);
            }
            updateProfilePageButton();
        };
    }

    // --- 10. POLLING SCHEDULER & RUNTIME ---
    let pollIndex = 0;
    async function pollSingleTarget(targetId) {
        const fresh = await fetchTargetTelemetry(targetId);
        if (fresh) evaluateTargetTriggers(targetId, fresh);
    }

    async function pollNextWatchlistTarget() {
        if (config.isPaused || watchlist.length === 0) return;

        let rapidTargetId = null;
        if (config.rapidHospPolling) {
            const nowSec = Math.floor(Date.now() / 1000);
            const thresholdSec = (config.nearHospThresholdMin || 5) * 60;
            let lowestRemaining = Infinity;
            for (const id of watchlist) {
                const info = targetsCache[id]?.data;
                if (info && info.state === 'Hospital' && info.until > nowSec) {
                    const rem = info.until - nowSec;
                    if (rem <= thresholdSec && rem < lowestRemaining) {
                        lowestRemaining = rem;
                        rapidTargetId = id;
                    }
                }
            }
        }

        const targetToPoll = rapidTargetId || watchlist[pollIndex % watchlist.length];
        pollIndex = (pollIndex + 1) % watchlist.length;

        await pollSingleTarget(targetToPoll);
    }

    // --- 10.1 UNTHROTTLED BACKGROUND TICKER (Web Worker) ---
    // Browsers aggressively throttle window.setInterval (down to 1 call/min) when tabs are unfocused.
    // A Blob Web Worker runs on an unthrottled worker thread, ensuring the 5-second API polling
    // continues uninterrupted even when Torn is minimized or in the background.
    function createBackgroundTicker(intervalMs, callback) {
        try {
            const blobCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(function() { self.postMessage('tick'); }, ${intervalMs});
                    } else if (e.data === 'stop') {
                        if (timer) clearInterval(timer);
                        timer = null;
                    }
                };
            `;
            const blob = new Blob([blobCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            worker.onmessage = function (e) {
                if (e.data === 'tick') callback();
            };
            worker.postMessage('start');
            return worker;
        } catch (e) {
            console.warn('[Stakeout] Web Worker fallback to setInterval:', e);
            const intervalId = setInterval(callback, intervalMs);
            return {
                terminate: () => clearInterval(intervalId),
                postMessage: () => {}
            };
        }
    }

    function boot() {
        if (!document.body) {
            setTimeout(boot, 100);
            return;
        }

        renderRadarUI();
        updateProfilePageButton();

        // Safe 1-second ticker for target UI and countdowns
        setInterval(() => {
            if (config.isMinimized || watchlist.length === 0) return;
            watchlist.forEach(id => updateTargetCardUI(id));
        }, 1000);

        // Safe 2-second checker for profile button without any MutationObserver
        setInterval(() => {
            if (window.location.href.includes('profiles.php')) {
                updateProfilePageButton();
            }
        }, 2000);

        // Main unthrottled poller (Web Worker with fallback)
        createBackgroundTicker((config.pollingInterval || 5) * 1000, pollNextWatchlistTarget);

        // Initial fetch for all targets
        if (watchlist.length > 0) {
            watchlist.forEach((id, idx) => {
                setTimeout(() => pollSingleTarget(id), idx * 1500);
            });
        }

        // Silent background update check once every 24h
        setTimeout(autoCheckForUpdates, 3500);
    }

    // Register Tampermonkey / Violentmonkey extension menu commands
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
