// ==UserScript==
// @name         TornPDA War Sorter & FF Scouter Enhanced
// @namespace    Violentmonkey Scripts
// @version      9.7
// @description  Torn PDA optimized combat suite: instant persistent BS caching, 7-tier threat badges, smart war sorting, live hospital countdowns & direct attack staging.
// @author       Merogie, rDacted, Weav3r, xentac - modded by Merogie & Antigravity
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      ffscouter.com
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_war_enhanced.user.js
// @updateURL    https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_war_enhanced.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // Guard against multiple injection on dynamic page reloads (per Torn PDA guidelines)
    if (window.__TORNPDA_WAR_ENHANCED_ACTIVE__) {
        if (typeof window.__TORNPDA_WAR_ENHANCED_RECHECK__ === 'function') {
            window.__TORNPDA_WAR_ENHANCED_RECHECK__();
        }
        return;
    }
    window.__TORNPDA_WAR_ENHANCED_ACTIVE__ = true;

    const SCRIPT_VERSION = 9.7;
    const SCRIPT_RAW_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_war_enhanced.user.js";
    const SETTINGS_KEY = 'tornpda-war-sorter-settings-v9';
    const CACHE_PREFIX = 'tornpda_ff_cache_';
    const CACHE_TTL_MS = 60 * 60 * 1000; // 1-Hour persistent cache
    const FF_API_BASE = 'https://ffscouter.com/api/v1';
    const BATCH_SIZE = 150;

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

    // --- 1. STYLES ---
    safeAddStyle(`
        .tornpda-hide { display: none !important; }

        .tornpda-status-box {
            color: #26bcf5;
            font-weight: 600;
            font-size: 11px;
            display: block;
            margin-top: 2px;
            line-height: 1.3;
            white-space: nowrap;
        }
        .tornpda-status-box.hosp { color: #ff6b6b; }
        .tornpda-status-box.okay { color: #4CAF50; }

        .tornpda-status-cell {
            display: block;
            padding: 2px 6px;
            box-sizing: border-box;
        }

        .tornpda-attack-link {
            display: inline-block;
            background: #166534;
            color: #ffffff !important;
            padding: 1px 7px;
            border-radius: 4px;
            text-decoration: none !important;
            font-weight: 700;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            transition: background 0.15s ease;
        }
        .tornpda-attack-link:active { background: #22c55e; }

        .tornpda-hosp-btn {
            display: inline-block;
            background: rgba(220, 38, 38, 0.2);
            border: 1px solid rgba(220, 38, 38, 0.5);
            color: #f87171 !important;
            padding: 1px 6px;
            border-radius: 4px;
            text-decoration: none !important;
            font-weight: 700;
            font-family: monospace, monospace;
            font-size: 11px;
            transition: all 0.15s ease;
        }
        .tornpda-hosp-btn:active {
            background: rgba(220, 38, 38, 0.4);
            border-color: #ef4444;
        }

        /* Vertical container holding Honor Bar on top and Battle Stats badge directly underneath */
        .tornpda-name-col-wrap {
            display: inline-flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            vertical-align: middle !important;
            margin: 0 4px !important;
            max-width: 145px !important;
            min-width: 105px !important;
            line-height: 1.15 !important;
            flex-shrink: 0 !important;
        }

        /* Battle-stats badge placed directly under the player's honor bar / name */
        .tornpda-stats-badge {
            position: static !important;
            display: inline-block !important;
            width: fit-content !important;
            max-width: 95% !important;
            margin: 2px auto 0 auto !important;
            font-size: 9.5px !important;
            font-weight: 800 !important;
            line-height: 1.2 !important;
            padding: 1px 6px !important;
            border-radius: 3px !important;
            text-align: center !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8) !important;
            letter-spacing: 0.3px !important;
            box-sizing: border-box !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
        }

        /* Dedicated Column mode styling */
        .tornpda-bs-col-cell, .tornpda-bs-header-cell {
            width: 60px !important;
            min-width: 50px !important;
            max-width: 75px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            box-sizing: border-box !important;
            font-size: 11px !important;
            font-weight: 700 !important;
        }

        /* 1-Click Fast Copy Button */
        .twse-copy-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 14px !important;
            height: 14px !important;
            margin-left: 4px !important;
            cursor: pointer !important;
            opacity: 0.6 !important;
            transition: opacity 0.15s ease !important;
            vertical-align: middle !important;
            color: #cbd5e1 !important;
            flex-shrink: 0 !important;
        }
        .twse-copy-btn:hover, .twse-copy-btn:active {
            opacity: 1 !important;
            color: #38bdf8 !important;
        }

        /* Attack Screen Hospital Banner */
        .ff-attack-hosp-banner {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin: 4px 0 8px 0 !important;
            padding: 5px 12px !important;
            border-radius: 6px !important;
            font-size: 12.5px !important;
            font-weight: 600 !important;
            background: rgba(220, 38, 38, 0.2) !important;
            border: 1px solid rgba(220, 38, 38, 0.5) !important;
            color: #fca5a5 !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) !important;
        }
        .ff-attack-hosp-banner.discharged {
            background: rgba(34, 197, 94, 0.25) !important;
            border-color: #22c55e !important;
            color: #86efac !important;
        }

        /* Attack Screen Overlay Countdown Box */
        .ff-attack-model-countdown {
            margin-top: 10px !important;
            padding: 6px 14px !important;
            background: rgba(15, 23, 42, 0.9) !important;
            border: 1.5px solid rgba(239, 68, 68, 0.7) !important;
            border-radius: 6px !important;
            text-align: center !important;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6) !important;
            user-select: none !important;
            pointer-events: none !important;
        }
        .ff-countdown-digits {
            font-size: 20px !important;
            font-weight: 900 !important;
            font-family: monospace, monospace !important;
            color: #f87171 !important;
            letter-spacing: 1.5px !important;
        }

        /* --- Absolute HP Tracking & Combat HUD for Torn PDA --- */
        .ff-player-hp-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            margin-left: auto !important;
            padding: 1px 6px !important;
            border-radius: 4px !important;
            font-family: monospace, monospace !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9) !important;
            white-space: nowrap !important;
            user-select: none !important;
            transition: all 0.2s ease !important;
            z-index: 10 !important;
        }

        .ff-player-hp-badge.high {
            background: rgba(22, 101, 52, 0.6) !important;
            border: 1px solid rgba(34, 197, 94, 0.7) !important;
            color: #4ade80 !important;
        }

        .ff-player-hp-badge.warning {
            background: rgba(161, 98, 7, 0.6) !important;
            border: 1px solid rgba(234, 179, 8, 0.7) !important;
            color: #facc15 !important;
        }

        .ff-player-hp-badge.danger {
            background: rgba(153, 27, 27, 0.7) !important;
            border: 1px solid #ef4444 !important;
            color: #fca5a5 !important;
            animation: ffExecuteGlowPDA 1.2s infinite ease-in-out !important;
        }

        .ff-player-hp-badge.dead {
            background: rgba(30, 41, 59, 0.7) !important;
            border: 1px solid rgba(148, 163, 184, 0.4) !important;
            color: #94a3b8 !important;
        }

        .ff-attack-hp-hud {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            flex-wrap: wrap !important;
            gap: 4px !important;
            margin: 4px 0 8px 0 !important;
            padding: 4px 10px !important;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.92) 100%) !important;
            border: 1px solid rgba(71, 85, 105, 0.5) !important;
            border-radius: 6px !important;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5) !important;
            box-sizing: border-box !important;
            width: 100% !important;
            clear: both !important;
        }

        .ff-hud-fighter {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            font-size: 11.5px !important;
            font-weight: 700 !important;
            color: #f1f5f9 !important;
        }

        .ff-hud-vs {
            font-size: 11px !important;
            font-weight: 900 !important;
            letter-spacing: 0.5px !important;
            color: #94a3b8 !important;
            padding: 0 4px !important;
        }

        .ff-hud-hp-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 3px !important;
            padding: 1px 6px !important;
            border-radius: 4px !important;
            font-family: monospace, monospace !important;
            font-size: 11px !important;
            font-weight: 800 !important;
        }

        .ff-hud-hp-pill.high {
            background: rgba(34, 197, 94, 0.25) !important;
            border: 1px solid rgba(34, 197, 94, 0.5) !important;
            color: #4ade80 !important;
        }

        .ff-hud-hp-pill.warning {
            background: rgba(234, 179, 8, 0.25) !important;
            border: 1px solid rgba(234, 179, 8, 0.5) !important;
            color: #facc15 !important;
        }

        .ff-hud-hp-pill.danger {
            background: rgba(239, 68, 68, 0.3) !important;
            border: 1px solid rgba(239, 68, 68, 0.6) !important;
            color: #f87171 !important;
            animation: ffExecuteGlowPDA 1.2s infinite ease-in-out !important;
        }

        .ff-hud-hp-pill.dead {
            background: rgba(148, 163, 184, 0.15) !important;
            border: 1px solid rgba(148, 163, 184, 0.3) !important;
            color: #94a3b8 !important;
        }

        .ff-hud-execute-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 2px !important;
            background: #dc2626 !important;
            color: #ffffff !important;
            font-size: 9.5px !important;
            font-weight: 900 !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            letter-spacing: 0.3px !important;
            animation: ffExecuteGlowPDA 0.8s infinite ease-in-out !important;
        }

        @keyframes ffExecuteGlowPDA {
            0% { box-shadow: 0 0 3px #ef4444; }
            50% { box-shadow: 0 0 8px #ef4444, 0 0 3px #dc2626; }
            100% { box-shadow: 0 0 3px #ef4444; }
        }

        /* Mobile Floating Controls */
        .tornpda-ctrl-container {
            position: fixed;
            bottom: 90px;
            left: 10px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .tornpda-ctrl-btn {
            width: 38px;
            height: 38px;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: #1e1e1e;
            color: #ffffff;
            border: 1px solid #475569;
            border-radius: 8px;
            font-size: 18px;
            box-shadow: 0 3px 6px rgba(0,0,0,0.5);
            opacity: 0.95;
            cursor: pointer;
        }
        .tornpda-ctrl-btn:active { transform: scale(0.95); }

        .tornpda-panel {
            position: fixed;
            bottom: 90px;
            left: 56px;
            z-index: 999999;
            width: 220px;
            background: #18181b;
            border: 1px solid #3f3f46;
            border-radius: 10px;
            color: #f4f4f5;
            font-size: 12px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.6);
            padding: 10px 12px;
        }
        .tornpda-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 700;
            font-size: 13px;
            margin-bottom: 8px;
            border-bottom: 1px solid #27272a;
            padding-bottom: 5px;
            color: #38bdf8;
        }
        .tornpda-panel-close { cursor: pointer; opacity: 0.7; padding: 2px 6px; font-size: 14px; }
        .tornpda-panel-label { font-weight: 700; opacity: 0.85; margin: 8px 0 3px; font-size: 11px; text-transform: uppercase; color: #94a3b8; }
        .tornpda-panel label { display: flex; align-items: center; gap: 7px; padding: 3px 0; cursor: pointer; }
        .tornpda-panel input[type=checkbox] { margin: 0; accent-color: #38bdf8; }
        .tornpda-panel select {
            width: 100%;
            background: #27272a;
            color: #eee;
            border: 1px solid #52525b;
            border-radius: 6px;
            padding: 5px;
            margin-bottom: 6px;
            font-size: 12px;
        }
        .tornpda-action-btn {
            width: 100%;
            margin-top: 6px;
            padding: 6px;
            background: #0284c7;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            font-weight: 700;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.15s ease;
        }
        .tornpda-action-btn:active { background: #0369a1; }
        .tornpda-update-btn {
            background: #15803d !important;
            margin-top: 4px;
        }
    `);

    // --- 2. API CREDENTIALS & PERSISTENT STORAGE ---
    function getApiKey() {
        // Priority 1: Check runtime key injected automatically by Torn PDA
        if (PDA_INJECTED_KEY && !PDA_INJECTED_KEY.includes('###') && PDA_INJECTED_KEY.trim().length >= 16) {
            return PDA_INJECTED_KEY.trim();
        }
        // Priority 2: Fall back to persistent localStorage keys
        try {
            let v3key = localStorage.getItem('ffsv3-configkey');
            if (v3key) return JSON.parse(v3key).value;
        } catch(e) {}
        return localStorage.getItem('twse-config-apikey') ||
               localStorage.getItem('limited_key') ||
               localStorage.getItem('torn_api_key') || null;
    }

    function safeJsonParse(text) {
        try { return JSON.parse(text || '{}'); } catch (e) { return {}; }
    }

    function fetchAPI(url) {
        if (typeof window.PDA_httpGet === 'function') {
            return window.PDA_httpGet(url)
                .then(res => safeJsonParse(typeof res === 'string' ? res : res && res.responseText))
                .catch(() => ({}));
        } else {
            return new Promise(resolve => {
                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    GM_xmlhttpRequest({
                        method: "GET", url: url,
                        onload: r => resolve(safeJsonParse(r && r.responseText)),
                        onerror: () => resolve({}),
                        ontimeout: () => resolve({})
                    });
                } else {
                    fetch(url)
                        .then(r => r.json())
                        .then(resolve)
                        .catch(() => resolve({}));
                }
            });
        }
    }

    // --- 3. PERSISTENT STORAGE ENGINE (Instant 0ms Cache) ---
    function getCachedStats(id) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + id);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.ts < CACHE_TTL_MS) {
                return parsed;
            }
        } catch(e) {}
        return null;
    }

    function setCachedStats(id, data) {
        try {
            localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({
                ts: Date.now(),
                ...data
            }));
        } catch(e) {}
    }

    // --- 4. 7-TIER BATTLE STATS THREAT ENGINE ---
    function parseBsStringToNumber(str) {
        if (!str) return null;
        if (typeof str === 'number') return str;
        if (typeof str !== 'string') return null;
        const clean = str.replace(/[{}\[\]()~><,]/g, ' ').trim().toLowerCase();
        const match = clean.match(/([\d.]+)\s*([kmbt])?/);
        if (!match) return null;
        const num = parseFloat(match[1]);
        const unit = match[2];
        if (isNaN(num)) return null;
        if (unit === 't') return num * 1e12;
        if (unit === 'b') return num * 1e9;
        if (unit === 'm') return num * 1e6;
        if (unit === 'k') return num * 1e3;
        return num;
    }

    function formatBattleStats(value) {
        if (!value) return null;
        let num = value;
        if (typeof num === 'string') num = parseBsStringToNumber(num);
        if (typeof num !== 'number' || isNaN(num) || num <= 0) {
            return typeof value === 'string' ? value : null;
        }

        // Strictly round to 3 significant figures across all tiers
        if (num >= 1e12) {
            const v = num / 1e12;
            if (v >= 100) return Math.round(v) + 't';
            if (v >= 10) return v.toFixed(1) + 't';
            return v.toFixed(2) + 't';
        }
        if (num >= 1e9) {
            const v = num / 1e9;
            if (v >= 100) return Math.round(v) + 'b';
            if (v >= 10) return v.toFixed(1) + 'b';
            return v.toFixed(2) + 'b';
        }
        if (num >= 1e6) {
            const v = num / 1e6;
            if (v >= 100) return Math.round(v) + 'm';
            if (v >= 10) return v.toFixed(1) + 'm';
            return v.toFixed(2) + 'm';
        }
        if (num >= 1e3) {
            const v = num / 1e3;
            if (v >= 100) return Math.round(v) + 'k';
            if (v >= 10) return v.toFixed(1) + 'k';
            return v.toFixed(2) + 'k';
        }
        return Math.round(num).toString();
    }

    function getTargetThreatInfo(bsNum, ffVal) {
        // Absolute tiering when numeric BS is available
        if (bsNum !== null && bsNum > 0) {
            if (bsNum < 1e6) {
                return { bg: '#64748b', text: '#ffffff', label: 'Beginner (<1M)' };
            } else if (bsNum < 1e7) {
                return { bg: '#16a34a', text: '#ffffff', label: 'Developing (1M-10M)' };
            } else if (bsNum < 5e7) {
                return { bg: '#0284c7', text: '#ffffff', label: 'Moderate (10M-50M)' };
            } else if (bsNum < 2.5e8) {
                return { bg: '#2563eb', text: '#ffffff', label: 'Veteran (50M-250M)' };
            } else if (bsNum < 1e9) {
                return { bg: '#9333ea', text: '#ffffff', label: 'Elite (250M-1B)' };
            } else if (bsNum < 5e9) {
                return { bg: '#ea580c', text: '#ffffff', label: 'Titan (1B-5B)' };
            } else {
                return { bg: '#dc2626', text: '#ffffff', label: 'Apex (5B+)' };
            }
        }
        // Relative FF fallback
        if (ffVal !== null && ffVal !== undefined) {
            if (ffVal < 1.5) return { bg: '#38bdf8', text: '#ffffff', label: 'Very Easy' };
            if (ffVal < 2.2) return { bg: '#2563eb', text: '#ffffff', label: 'Easy' };
            if (ffVal < 3.2) return { bg: '#16a34a', text: '#ffffff', label: 'Moderate' };
            if (ffVal < 4.2) return { bg: '#f97316', text: '#ffffff', label: 'Challenging' };
            return { bg: '#dc2626', text: '#ffffff', label: 'Cannot Win' };
        }
        return { bg: '#475569', text: '#ffffff', label: 'Unrated' };
    }

    // --- 5. STATE & DESTINATIONS ---
    const memberData = {};
    const memberCountdowns = {}; // targetId -> { until, state, desc }
    const targetLifeData = {};    // targetId -> { current, maximum, name }
    let myMaxHp = null;

    const DEST_TABLE = {
        "mexico": "MX", "cayman islands": "CI", "canada": "CA",
        "hawaii": "HI", "united kingdom": "UK", "argentina": "AR",
        "switzerland": "SW", "japan": "JP", "china": "CN",
        "uae": "UAE", "south africa": "SA", "torn": "TC"
    };

    const SORT_FIELDS = [
        ['war_smart', '⚔️ Hosp / War Smart (Onlines First)'],
        ['stats_asc', '▲ Lowest BS'],
        ['stats_desc', '▼ Highest BS'],
        ['time', '⏱️ Time Remaining'],
        ['level', 'Level'],
        ['none', 'Default Torn']
    ];

    const DEFAULT_SETTINGS = {
        sort: { primaryField: 'war_smart', primaryDir: 'asc' },
        badgePos: 'under_name', // 'under_name' | 'col' | 'inline'
        activityFilter: { online: true, idle: true, offline: true },
        statusFilter: { okay: true, hospital: true, jail: true, traveling: true, abroad: true }
    };

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            const parsed = JSON.parse(raw);
            return {
                sort: Object.assign({}, DEFAULT_SETTINGS.sort, parsed.sort),
                badgePos: parsed.badgePos || DEFAULT_SETTINGS.badgePos,
                activityFilter: Object.assign({}, DEFAULT_SETTINGS.activityFilter, parsed.activityFilter),
                statusFilter: Object.assign({}, DEFAULT_SETTINGS.statusFilter, parsed.statusFilter)
            };
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }
    }

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    }

    let settings = loadSettings();

    const urlParams = new URLSearchParams(location.search);
    const sid = urlParams.get('sid');
    const PAGE = {
        faction: location.href.startsWith('https://www.torn.com/factions.php') && !location.href.includes('step=listing') && !location.href.includes('step=search'),
        attack: location.href.includes('sid=attack'),
        profile: location.href.startsWith('https://www.torn.com/profiles.php'),
        bounty: location.href.startsWith('https://www.torn.com/bounties.php'),
        company: location.href.startsWith('https://www.torn.com/companies.php'),
        joblist: location.href.startsWith('https://www.torn.com/joblist.php'),
        messages: location.href.startsWith('https://www.torn.com/messages.php'),
        index: location.href.startsWith('https://www.torn.com/index.php'),
        hospital: location.href.startsWith('https://www.torn.com/hospitalview.php'),
        userlist: location.href.startsWith('https://www.torn.com/page.php') && sid === 'UserList',
        hof: location.href.startsWith('https://www.torn.com/page.php') && sid === 'hof',
        forums: location.href.startsWith('https://www.torn.com/forums.php')
    };

    // --- 6. FAST QUEUE FETCHING (Fixes Slow Low-Stat Loading) ---
    // In Torn, Player IDs are chronological: High IDs = newer accounts / lower battle stats.
    // By prioritizing visible IDs and sorting remaining queue descending, lower stats load FIRST!
    let ffQueue = [];
    const ffQueued = new Set();
    let isFetchingBatch = false;

    function queueIdsForFetch(ids, prioritizeDescending = true) {
        ids.forEach(id => {
            const strId = String(id);
            // Check persistent cache first
            const cached = getCachedStats(strId);
            if (cached) {
                if (!memberData[strId]) memberData[strId] = {};
                Object.assign(memberData[strId], cached);
            } else if (!ffQueued.has(strId)) {
                ffQueue.push(strId);
                ffQueued.add(strId);
            }
        });

        if (prioritizeDescending) {
            // Sort high IDs (newer accounts / lower stats) to the front of the queue
            ffQueue.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
        }

        scheduleBatchFetch();
    }

    let fetchDebounceTimer = null;
    function scheduleBatchFetch() {
        if (fetchDebounceTimer) return;
        fetchDebounceTimer = setTimeout(() => {
            fetchDebounceTimer = null;
            processFFQueue();
        }, 150);
    }

    async function processFFQueue() {
        if (isFetchingBatch || ffQueue.length === 0) return;
        const apiKey = getApiKey();
        if (!apiKey) return;

        isFetchingBatch = true;
        const batch = ffQueue.splice(0, BATCH_SIZE);
        batch.forEach(id => ffQueued.delete(id));

        try {
            const url = `${FF_API_BASE}/get-stats?key=${apiKey}&targets=${batch.join(',')}`;
            const data = await fetchAPI(url);

            if (Array.isArray(data)) {
                const seen = new Set();
                data.forEach(r => {
                    if (!r || !r.player_id) return;
                    const idStr = String(r.player_id);
                    seen.add(idStr);
                    if (!memberData[idStr]) memberData[idStr] = {};

                    const entry = {
                        ff: r.fair_fight,
                        ffLastUpdated: r.last_updated,
                        bsEstimate: r.bs_estimate,
                        bsEstimateHuman: r.bs_estimate_human,
                        ffNoData: !r.fair_fight && !r.bs_estimate
                    };

                    Object.assign(memberData[idStr], entry);
                    setCachedStats(idStr, entry);
                });

                batch.forEach(idStr => {
                    if (!seen.has(idStr)) {
                        const noDataEntry = { ffNoData: true };
                        if (!memberData[idStr]) memberData[idStr] = {};
                        Object.assign(memberData[idStr], noDataEntry);
                        setCachedStats(idStr, noDataEntry);
                    }
                });
            }
        } catch(e) {
            console.error('[TornPDA] FF API Fetch Error:', e);
        } finally {
            isFetchingBatch = false;
            if (ffQueue.length > 0) {
                setTimeout(processFFQueue, 500);
            }
        }
    }

    // --- 7. FAST 1-CLICK COPY UTILITY ---
    function attachCopyButton(container, playerId, playerName) {
        if (!container || container.querySelector('.twse-copy-btn')) return;
        const btn = document.createElement('span');
        btn.className = 'twse-copy-btn';
        btn.title = `Copy "${playerName} [${playerId}]"`;
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const copyText = `${playerName} [${playerId}]`;
            navigator.clipboard.writeText(copyText).then(() => {
                alert(`Copied: ${copyText}`);
            }).catch(() => {
                prompt("Target ID:", copyText);
            });
        });

        container.appendChild(btn);
    }

    // --- 8. HELPERS & FORMATTING ---
    function shortenDest(name) { return DEST_TABLE[(name || '').trim().toLowerCase()] || name; }

    function formatTime(sec) {
        sec = Math.max(0, Math.floor(sec));
        let h = Math.floor(sec / 3600).toString().padStart(2, '0');
        let m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
        let s = Math.floor(sec % 60).toString().padStart(2, '0');
        if (h > 0) return `${h}:${m}:${s}`;
        return `${m}:${s}`;
    }

    function getMemberCell(li) { return li.querySelector('.member') || li; }

    function getPlayerId(li) {
        const memberCell = getMemberCell(li);
        const a = memberCell.querySelector('a[href*="XID="]');
        return a ? a.href.match(/XID=(\d+)/)?.[1] : null;
    }

    function getPlayerIdFromElement(el) {
        if (!el) return null;
        const parentHref = el.parentElement && el.parentElement.href;
        if (parentHref) {
            const m = parentHref.match(/XID=(\d+)/);
            if (m) return m[1];
        }
        const anchors = el.getElementsByTagName ? el.getElementsByTagName('a') : [];
        for (const a of anchors) {
            const m = a.href && a.href.match(/XID=(\d+)/);
            if (m) return m[1];
        }
        if (el.tagName === 'A' && el.href) {
            const m = el.href.match(/XID=(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    function attackUrl(playerId) {
        return `https://www.torn.com/loader.php?sid=attack&user2ID=${playerId}`;
    }

    function getStatusBox(li) {
        let statusBox = li.querySelector('.tornpda-status-box');
        if (statusBox) return statusBox;

        const statusCell = li.querySelector('.status');
        if (statusCell) {
            statusCell.textContent = '';
            statusBox = document.createElement('div');
            statusBox.className = 'tornpda-status-box';
            statusCell.appendChild(statusBox);
            return statusBox;
        }

        const memberCell = li.querySelector('.member');
        if (!memberCell || !memberCell.parentNode) return null;
        statusBox = document.createElement('div');
        statusBox.className = 'tornpda-status-box tornpda-status-cell';
        memberCell.parentNode.insertBefore(statusBox, memberCell.nextSibling);
        return statusBox;
    }

    function getMemberOnlineTier(li, m) {
        if (m) {
            const act = (m.activity || (m.last_action && m.last_action.status) || '').toLowerCase();
            if (act === 'online') return 1;
            if (act === 'idle' || act === 'offline') return 2;
        }
        if (li) {
            const svgUse = li.querySelector('svg use');
            const href = svgUse ? (svgUse.getAttribute('href') || svgUse.getAttribute('xlink:href') || '') : '';
            if (href.includes('icon1') || li.querySelector('[id*="icon1"], .online, [class*="online___"], [class*="online-icon"], [class*="userStatusOnline"], [class*="status-online"]')) return 1;

            if (li.querySelector('[title*="Online" i], [aria-label*="Online" i], [data-title*="Online" i]')) return 1;

            // Fallback: check SVG / circle elements with green fills (Torn green for online)
            const coloredEls = li.querySelectorAll('svg, circle, path, [class*="status"], [class*="icon"]');
            for (const el of coloredEls) {
                const fill = (el.getAttribute('fill') || el.style.fill || el.style.color || '').toLowerCase();
                if (fill.includes('#00a859') || fill.includes('#4caf50') || fill.includes('#22c55e') || fill.includes('#5cb85c') || fill.includes('rgb(0, 168, 89)')) return 1;
            }
        }
        // Idle and Offline are treated as the same non-online tier
        return 2;
    }

    function ensureHeaderColumn() {
        const headers = document.querySelectorAll('ul.table-header, .members-list-header, .members-header, .table-row.table-header');
        headers.forEach(header => {
            let colHead = header.querySelector('.tornpda-bs-header-cell');
            if (settings.badgePos === 'col') {
                if (!colHead) {
                    colHead = document.createElement('li');
                    colHead.className = 'tornpda-bs-header-cell';
                    colHead.textContent = 'Est. BS';
                    const lvlHead = header.querySelector('.lvl, [class*="lvl___"], .level');
                    if (lvlHead) header.insertBefore(colHead, lvlHead);
                    else header.appendChild(colHead);
                }
            } else if (colHead) {
                colHead.remove();
            }
        });
    }

    function getStatsBadge(li) {
        let badge = li.querySelector('.tornpda-stats-badge');
        if (badge) return badge;

        badge = document.createElement('span');
        badge.className = 'tornpda-stats-badge';

        const pos = settings.badgePos || 'under_name';
        const memberCell = li.querySelector('.member') || li.querySelector('[class*="member___"]') || li;
        const nameLink = memberCell.querySelector('a[href*="XID="]');

        if (pos === 'col') {
            let colCell = li.querySelector('.tornpda-bs-col-cell');
            if (!colCell) {
                colCell = document.createElement('div');
                colCell.className = 'tornpda-bs-col-cell';
                const lvlCell = li.querySelector('.lvl, [class*="lvl___"], .level');
                if (lvlCell) {
                    li.insertBefore(colCell, lvlCell);
                } else if (memberCell && memberCell.nextSibling) {
                    li.insertBefore(colCell, memberCell.nextSibling);
                } else {
                    li.appendChild(colCell);
                }
            }
            colCell.appendChild(badge);
            return badge;
        }

        if (pos === 'under_name' && nameLink && nameLink.parentNode) {
            let wrap = nameLink.closest('.tornpda-name-col-wrap');
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.className = 'tornpda-name-col-wrap';
                nameLink.parentNode.insertBefore(wrap, nameLink);
                wrap.appendChild(nameLink);
            }
            wrap.appendChild(badge);
            return badge;
        }

        if (nameLink && nameLink.parentNode) {
            nameLink.parentNode.insertBefore(badge, nameLink.nextSibling);
        } else if (memberCell) {
            memberCell.appendChild(badge);
        }
        return badge;
    }

    function renderStatsBadge(badge, m) {
        if (!m || m.ffNoData || (m.bsEstimateHuman === undefined && m.bsEstimate === undefined)) {
            badge.textContent = '-';
            badge.style.backgroundColor = '#3f3f46';
            badge.style.color = '#a1a1aa';
            badge.title = 'No Data';
            return;
        }

        const bsNum = m.bsEstimate || parseBsStringToNumber(m.bsEstimateHuman);
        const threat = getTargetThreatInfo(bsNum, m.ff);
        const displayVal = formatBattleStats(bsNum) || m.bsEstimateHuman || (m.ff ? `FF ${m.ff.toFixed(2)}` : '-');

        badge.style.backgroundColor = threat.bg;
        badge.style.color = threat.text;
        badge.textContent = displayVal;
        badge.title = `${threat.label} • Fair Fight: ${m.ff ? m.ff.toFixed(2) : 'N/A'}`;
    }

    function setStatusContent(statusBox, text, url, isHosp = false) {
        statusBox.textContent = '';
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.className = isHosp ? 'tornpda-hosp-btn' : 'tornpda-attack-link';
            a.textContent = text;
            a.title = isHosp ? 'Click to open pre-staged attack screen!' : 'Attack Now!';
            a.addEventListener('click', (e) => e.stopPropagation());
            statusBox.appendChild(a);
        } else {
            statusBox.appendChild(document.createTextNode(text));
        }
    }

    // --- 9. ATTACK PAGE REAL-TIME COUNTDOWN BANNER & ABSOLUTE HP ---
    let attackFetchInProgress = false;
    async function checkAndRenderAttackHospTimer() {
        if (!PAGE.attack) return;
        const match = location.href.match(/user2ID=(\d+)/);
        if (!match) return;
        const targetId = match[1];

        const nowSec = Math.floor(Date.now() / 1000);
        let cached = memberCountdowns[targetId] || getCachedStats(`hosp_${targetId}`);
        const cachedLife = targetLifeData[targetId] || getCachedStats(`target_life_${targetId}`);

        const apiKey = getApiKey();
        if ((!cached || !cached.until || cached.until < nowSec || !cachedLife) && apiKey && !attackFetchInProgress) {
            attackFetchInProgress = true;
            try {
                const url = `https://api.torn.com/user/${targetId}?selections=profile,basic&key=${apiKey}&comment=PDAWarAttack`;
                const data = await fetchAPI(url);
                if (data) {
                    if (data.status) {
                        const until = parseInt(data.status.until || '0', 10);
                        const state = data.status.state || '';
                        const desc = data.status.description || '';
                        memberCountdowns[targetId] = { until, state, desc };
                        setCachedStats(`hosp_${targetId}`, memberCountdowns[targetId]);
                        cached = memberCountdowns[targetId];
                    }
                    if (data.life && data.life.maximum) {
                        targetLifeData[targetId] = {
                            current: parseInt(data.life.current, 10) || 0,
                            maximum: parseInt(data.life.maximum, 10) || 0,
                            name: data.name || ''
                        };
                        setCachedStats(`target_life_${targetId}`, targetLifeData[targetId]);
                        updateAttackHpDisplay();
                    }
                }
            } catch (e) {
            } finally {
                attackFetchInProgress = false;
            }
        }

        if (!cached || cached.state !== 'Hospital') return;

        const remainingSec = (cached.until > nowSec) ? cached.until - nowSec : 0;
        const timeStr = formatTime(remainingSec);

        // Header Banner
        let banner = document.getElementById('ff-attack-hosp-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'ff-attack-hosp-banner';
            banner.className = 'ff-attack-hosp-banner';
            const root = document.getElementById('attack-root') || document.querySelector('.content-wrapper') || document.body;
            root.prepend(banner);
        }

        if (remainingSec <= 0) {
            banner.className = 'ff-attack-hosp-banner discharged';
            banner.innerHTML = `⚡ <strong>TARGET DISCHARGED!</strong> Ready to attack`;
        } else {
            banner.innerHTML = `🏥 In Hospital: <strong style="font-family:monospace;">${timeStr}</strong> (${cached.desc || 'In Hospital'})`;
        }
    }

    function getMyPlayerName() {
        try {
            const userEl = document.getElementById('torn-user');
            if (userEl && userEl.value) {
                const data = JSON.parse(userEl.value);
                if (data.playername) return data.playername;
            }
        } catch (e) {}
        const nameEl = document.querySelector('[class*="menu-info-name"], [class*="userName___"], #sidebar a[href*="profiles.php"]');
        if (nameEl) {
            const t = nameEl.textContent.trim();
            if (t) return t;
        }
        return 'Merogie';
    }

    function getAttackerMaxHp() {
        const barLife = document.getElementById('barLife') || document.querySelector('[class*="bar-life"]');
        if (barLife) {
            const text = barLife.textContent || '';
            const m = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
            if (m) {
                const max = parseInt(m[2].replace(/,/g, ''), 10);
                if (max > 0) {
                    try { localStorage.setItem('tornpda_my_max_hp', String(max)); } catch(e) {}
                    return max;
                }
            }
        }
        try {
            const cached = localStorage.getItem('tornpda_my_max_hp');
            if (cached) {
                const val = parseInt(cached, 10);
                if (val > 0) return val;
            }
        } catch(e) {}
        return 3937;
    }

    function findFighterCards() {
        let attackerCard = document.getElementById('attacker') || 
                           document.querySelector('[class*="attacker___"], [class*="player___"][class*="user___"]');
        let defenderCard = document.getElementById('defender') || 
                           document.querySelector('[class*="defender___"], [class*="player___"][class*="opponent___"]');

        const players = Array.from(document.querySelectorAll('[class*="player___"], [class*="playerWindow___"], [class*="player-window"]'));
        if (players.length >= 2) {
            if (!attackerCard) attackerCard = players[0];
            if (!defenderCard) defenderCard = players[1];
        }

        const myName = getMyPlayerName();
        const match = location.href.match(/user2ID=(\d+)/);
        const targetId = match ? match[1] : null;
        const targetLife = targetId ? (targetLifeData[targetId] || getCachedStats(`target_life_${targetId}`)) : null;
        const targetName = targetLife?.name;

        if (attackerCard && defenderCard && myName && targetName) {
            const attText = attackerCard.textContent || '';
            const defText = defenderCard.textContent || '';
            if (!attText.includes(myName) && defText.includes(myName)) {
                const tmp = attackerCard;
                attackerCard = defenderCard;
                defenderCard = tmp;
            }
        }

        return { attackerCard, defenderCard };
    }

    function extractLifePercent(cardEl) {
        if (!cardEl) return null;

        const barCandidates = cardEl.querySelectorAll(
            '[class*="life___"], [class*="health___"], [class*="progress___"], [class*="statusBar___"], [role="progressbar"]'
        );

        for (const bar of barCandidates) {
            if (bar.closest('[class*="weapon___"], [class*="equip___"], [class*="item___"], [class*="cooldown___"], .ff-player-hp-badge, .ff-attack-hp-hud')) continue;

            const fills = [bar, ...bar.querySelectorAll('[class*="fill___"], [class*="filler___"], div')];
            for (const el of fills) {
                const w = el.style && el.style.width;
                if (w && w.includes('%')) {
                    const m = w.match(/([\d.]+)%/);
                    if (m) {
                        const val = parseFloat(m[1]);
                        if (!isNaN(val) && val >= 0 && val <= 100) return val;
                    }
                }
                const transform = el.style && el.style.transform;
                if (transform && transform.includes('scaleX')) {
                    const m = transform.match(/scaleX\(([\d.]+)\)/);
                    if (m) {
                        const val = parseFloat(m[1]) * 100;
                        if (!isNaN(val) && val >= 0 && val <= 100) return val;
                    }
                }
            }
        }

        const allFills = cardEl.querySelectorAll('div[style*="width"], [role="progressbar"]');
        for (const el of allFills) {
            if (el.closest('[class*="weapon___"], [class*="equip___"], [class*="item___"], [class*="cooldown___"], .ff-player-hp-badge, .ff-attack-hp-hud')) continue;
            const w = el.style && el.style.width;
            if (w && w.includes('%')) {
                const m = w.match(/([\d.]+)%/);
                if (m) {
                    const val = parseFloat(m[1]);
                    if (!isNaN(val) && val >= 0 && val <= 100) return val;
                }
            }
        }

        return null;
    }

    function extractHpText(cardEl) {
        if (!cardEl) return null;
        const textElements = cardEl.querySelectorAll('span, div, p');
        for (const el of textElements) {
            if (el.closest('.ff-player-hp-badge, .ff-attack-hp-hud, .ff-countdown-digits, [class*="weapon___"]')) continue;
            const txt = (el.textContent || '').trim();
            const m = txt.match(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)$/);
            if (m) {
                const curr = parseInt(m[1].replace(/,/g, ''), 10);
                const max = parseInt(m[2].replace(/,/g, ''), 10);
                if (!isNaN(curr) && !isNaN(max) && max > 0 && curr <= max * 1.5) {
                    return { current: curr, maximum: max, percent: (curr / max) * 100, exactFromDom: true };
                }
            }
        }
        return null;
    }

    function getFighterHpInfo(cardEl, knownMaxHp, isAttacker) {
        if (!cardEl) return null;

        const fromText = extractHpText(cardEl);
        if (fromText) return fromText;

        const percent = extractLifePercent(cardEl);
        if (percent === null) {
            if (knownMaxHp > 0) {
                return { current: knownMaxHp, maximum: knownMaxHp, percent: 100, exactFromDom: false };
            }
            return null;
        }

        const max = knownMaxHp || (isAttacker ? getAttackerMaxHp() : 0);
        let curr = max > 0 ? Math.round((percent / 100) * max) : 0;
        if (percent <= 0) curr = 0;
        if (percent >= 100 && max > 0) curr = max;

        return {
            current: curr,
            maximum: max,
            percent: percent,
            exactFromDom: false
        };
    }

    function updateFighterHpBadge(cardEl, hpInfo, fighterName) {
        if (!cardEl || !hpInfo) return;

        const headerEl = cardEl.querySelector('[class*="header___"], [class*="title___"], h4, .header, [class*="userName___"]') || cardEl;
        if (headerEl && headerEl !== cardEl) {
            headerEl.style.display = 'flex';
            headerEl.style.alignItems = 'center';
            headerEl.style.justifyContent = 'space-between';
        }

        let badge = cardEl.querySelector('.ff-player-hp-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'ff-player-hp-badge';
            if (headerEl && headerEl !== cardEl) {
                headerEl.appendChild(badge);
            } else {
                cardEl.prepend(badge);
            }
        }

        const pct = hpInfo.percent;
        let tierClass = 'high';
        let executeBadge = '';

        if (pct <= 0) {
            tierClass = 'dead';
        } else if (pct <= 20) {
            tierClass = 'danger';
            executeBadge = '<span class="ff-hud-execute-badge">⚔️ EXECUTE</span>';
        } else if (pct < 50) {
            tierClass = 'warning';
        }

        badge.className = `ff-player-hp-badge ${tierClass}`;

        let hpDisplay = '';
        if (hpInfo.maximum > 0) {
            const pctStr = pct.toFixed(pct % 1 === 0 ? 0 : 1);
            hpDisplay = `${hpInfo.current.toLocaleString()} / ${hpInfo.maximum.toLocaleString()} (${pctStr}%)`;
        } else {
            hpDisplay = `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}% HP`;
        }

        badge.innerHTML = `
            <span class="ff-hp-val">❤️ ${hpDisplay}</span>
            ${executeBadge}
        `;
    }

    function updateAttackHpHud(attackerHp, defenderHp, attackerName, defenderName) {
        const attackRoot = document.getElementById('attack-root') || document.querySelector('.content-wrapper') || document.getElementById('mainContainer');
        if (!attackRoot) return;

        let hud = document.getElementById('ff-attack-hp-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'ff-attack-hp-hud';
            hud.className = 'ff-attack-hp-hud';

            const hospBanner = document.getElementById('ff-attack-hosp-banner');
            if (hospBanner && hospBanner.parentNode) {
                hospBanner.parentNode.insertBefore(hud, hospBanner.nextSibling);
            } else {
                const topHeader = attackRoot.querySelector('h4, [class*="title___"], [class*="header___"], [class*="title"], [class*="top___"]');
                if (topHeader && topHeader.parentNode) {
                    topHeader.parentNode.insertBefore(hud, topHeader.nextSibling);
                } else {
                    attackRoot.prepend(hud);
                }
            }
        }

        const getTier = (pct) => {
            if (pct <= 0) return 'dead';
            if (pct <= 20) return 'danger';
            if (pct < 50) return 'warning';
            return 'high';
        };

        const attTier = attackerHp ? getTier(attackerHp.percent) : 'high';
        const defTier = defenderHp ? getTier(defenderHp.percent) : 'high';

        const attStr = attackerHp ? (attackerHp.maximum > 0 ? `${attackerHp.current.toLocaleString()} / ${attackerHp.maximum.toLocaleString()} (${attackerHp.percent.toFixed(attackerHp.percent % 1 === 0 ? 0 : 1)}%)` : `${attackerHp.percent.toFixed(1)}%`) : '--';
        const defStr = defenderHp ? (defenderHp.maximum > 0 ? `${defenderHp.current.toLocaleString()} / ${defenderHp.maximum.toLocaleString()} (${defenderHp.percent.toFixed(defenderHp.percent % 1 === 0 ? 0 : 1)}%)` : `${defenderHp.percent.toFixed(1)}%`) : '--';

        const defExecute = (defenderHp && defenderHp.percent > 0 && defenderHp.percent <= 20)
            ? '<span class="ff-hud-execute-badge">⚔️ EXECUTE READY</span>'
            : '';

        hud.innerHTML = `
            <div class="ff-hud-fighter ff-hud-attacker">
                <span>🛡️</span>
                <span>${attackerName || 'You'}:</span>
                <span class="ff-hud-hp-pill ${attTier}">${attStr}</span>
            </div>
            <div class="ff-hud-vs">VS</div>
            <div class="ff-hud-fighter ff-hud-defender">
                <span>⚔️</span>
                <span>${defenderName || 'Target'}:</span>
                <span class="ff-hud-hp-pill ${defTier}">${defStr}</span>
                ${defExecute}
            </div>
        `;
    }

    function updateAttackHpDisplay() {
        if (!PAGE.attack) return;

        const { attackerCard, defenderCard } = findFighterCards();
        if (!attackerCard && !defenderCard) return;

        const match = location.href.match(/user2ID=(\d+)/);
        const targetId = match ? match[1] : null;
        const cachedTargetLife = targetId ? (targetLifeData[targetId] || getCachedStats(`target_life_${targetId}`)) : null;
        const defenderMaxHp = cachedTargetLife?.maximum || 0;
        const defenderName = cachedTargetLife?.name || (defenderCard?.querySelector('[class*="header___"], [class*="title___"], h4, .header, [class*="userName___"]')?.textContent?.trim() || 'Target');

        const attackerMaxHp = getAttackerMaxHp();
        const attackerName = getMyPlayerName();

        let attackerHp = null;
        let defenderHp = null;

        if (attackerCard) {
            attackerHp = getFighterHpInfo(attackerCard, attackerMaxHp, true);
            if (attackerHp) updateFighterHpBadge(attackerCard, attackerHp, attackerName);
        }

        if (defenderCard) {
            defenderHp = getFighterHpInfo(defenderCard, defenderMaxHp, false);
            if (defenderHp) updateFighterHpBadge(defenderCard, defenderHp, defenderName);
        }

        if (attackerHp || defenderHp) {
            updateAttackHpHud(attackerHp, defenderHp, attackerName, defenderName);
        }
    }

    let attackHpObserver = null;
    function initAttackPageHpTracker() {
        if (!PAGE.attack) return;

        checkAndRenderAttackHospTimer();
        updateAttackHpDisplay();

        const attackRoot = document.getElementById('attack-root') || document.querySelector('.content-wrapper') || document.body;
        if (attackRoot && !attackHpObserver) {
            attackHpObserver = new MutationObserver(() => {
                updateAttackHpDisplay();
            });
            attackHpObserver.observe(attackRoot, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'width']
            });
        }
    }

    // --- 10. UNIFIED SORTING & FILTERING ---
    function sortAndFilterRoster() {
        ensureHeaderColumn();
        const lists = document.querySelectorAll('ul.members-list, ul.member-list, .table-body');
        const now = Date.now() / 1000;

        lists.forEach(ul => {
            const items = Array.from(ul.querySelectorAll(':scope > .table-row, :scope > li.enemy, :scope > li.your, :scope > li'));
            const entries = [];
            const idsOnScreen = [];

            items.forEach((li, idx) => {
                if (li.classList.contains('table-header') || li.classList.contains('members-list-header')) return;
                const playerId = getPlayerId(li);
                if (!playerId) return;

                idsOnScreen.push(playerId);
                const m = memberData[playerId] || getCachedStats(playerId) || {};

                // Attach copy button
                const nameContainer = li.querySelector('.member, a[href*="XID="]');
                if (nameContainer) {
                    const playerName = (nameContainer.textContent || '').trim().replace(/\s+\[\d+\]$/, '');
                    attachCopyButton(nameContainer, playerId, playerName);
                }

                // Render Badge
                const badge = getStatsBadge(li);
                if (badge) renderStatsBadge(badge, m);

                // Render Status
                const statusBox = getStatusBox(li);
                if (statusBox) {
                    statusBox.classList.remove('hosp', 'okay');
                    const liveTxt = (statusBox.textContent || '').trim();

                    if (m.state === "Hospital" || m.state === "Jail" || liveTxt.includes(':')) {
                        let rem = m.until ? Math.max(0, m.until - now) : 0;
                        if (rem > 0) memberCountdowns[playerId] = { until: m.until, state: m.state, desc: m.desc };
                        setStatusContent(statusBox, `${m.state === "Hospital" ? "🏥" : "🚓"} ${formatTime(rem)}`, attackUrl(playerId), true);
                        statusBox.classList.add('hosp');
                    } else if (m.state === "Traveling") {
                        let dir = m.travelDir || "✈️ Traveling";
                        setStatusContent(statusBox, dir, null);
                    } else if (m.state === "Abroad") {
                        setStatusContent(statusBox, `📍 ${shortenDest((m.desc || '').replace("In ", ""))}`, null);
                    } else if (m.state === "Okay" || liveTxt.toLowerCase().includes('okay')) {
                        setStatusContent(statusBox, "⚔️ Okay", attackUrl(playerId), false);
                        statusBox.classList.add('okay');
                    } else if (m.state) {
                        setStatusContent(statusBox, m.state, null);
                    }
                }

                // Classification for smart war sorting
                const liveStatusTxt = (statusBox ? statusBox.textContent : (li.querySelector('.status, .table-cell.status')?.textContent || '')).trim().toLowerCase();
                const isOkay = (m.state === "Okay") || liveStatusTxt.includes('okay');
                const isHosp = (m.state === "Hospital") || liveStatusTxt.includes('hosp') || liveStatusTxt.includes('🏥') || liveStatusTxt.includes(':');
                const onlineTier = getMemberOnlineTier(li, m);

                // Filtering visibility
                const statusKey = (m.state || '').toLowerCase();
                const statusOk = !statusKey || settings.statusFilter[statusKey] !== false;
                const activityOk = !m.activity || settings.activityFilter[m.activity] !== false;
                const visible = statusOk && activityOk;

                if (visible) li.classList.remove('tornpda-hide');
                else li.classList.add('tornpda-hide');

                entries.push({ li, m, playerId, idx, isOkay, isHosp, onlineTier });
            });

            // Queue visible IDs for immediate prioritized fetching
            if (idsOnScreen.length > 0) {
                queueIdsForFetch(idsOnScreen, true);
            }

            // Sorting
            const sortMode = settings.sort.primaryField;
            if (sortMode !== 'none') {
                entries.sort((a, b) => {
                    const aBs = a.m.bsEstimate || parseBsStringToNumber(a.m.bsEstimateHuman);
                    const bBs = b.m.bsEstimate || parseBsStringToNumber(b.m.bsEstimateHuman);

                    if (sortMode === 'war_smart') {
                        const aIsOkay = a.isOkay;
                        const bIsOkay = b.isOkay;

                        if (aIsOkay && bIsOkay) {
                            // 1. Online Targets FIRST (Tier 1: Online < Tier 2: Idle < Tier 3: Offline)
                            if (a.onlineTier !== b.onlineTier) {
                                return a.onlineTier - b.onlineTier;
                            }
                            // 2. Within same online tier, sort by Battle Stats ascending (lowest BS first)
                            if (aBs !== null && bBs !== null) return aBs - bBs;
                            if (aBs !== null && bBs === null) return -1;
                            if (aBs === null && bBs !== null) return 1;
                            return a.idx - b.idx;
                        }

                        // Available targets always stay on top
                        if (aIsOkay && !bIsOkay) return -1;
                        if (!aIsOkay && bIsOkay) return 1;

                        // Non-available targets: Hospital first (least time remaining)
                        if (a.isHosp && b.isHosp) {
                            return (a.m.until || 0) - (b.m.until || 0);
                        }
                        if (a.isHosp && !b.isHosp) return -1;
                        if (!a.isHosp && b.isHosp) return 1;

                        return a.idx - b.idx;
                    } else if (sortMode === 'stats_asc') {
                        if (aBs !== null && bBs !== null) return aBs - bBs;
                        return aBs !== null ? -1 : (bBs !== null ? 1 : a.idx - b.idx);
                    } else if (sortMode === 'stats_desc') {
                        if (aBs !== null && bBs !== null) return bBs - aBs;
                        return aBs !== null ? -1 : (bBs !== null ? 1 : a.idx - b.idx);
                    } else if (sortMode === 'time') {
                        const aRem = Math.max(0, (a.m.until || 0) - now);
                        const bRem = Math.max(0, (b.m.until || 0) - now);
                        return aRem - bRem;
                    } else if (sortMode === 'level') {
                        const aLvl = parseInt(a.li.querySelector('.lvl, .level')?.textContent || '0', 10);
                        const bLvl = parseInt(b.li.querySelector('.lvl, .level')?.textContent || '0', 10);
                        return aLvl - bLvl;
                    }
                    return a.idx - b.idx;
                });

                // Physical DOM reordering guarantees visual order across mobile webviews
                entries.forEach(e => ul.appendChild(e.li));
            }
        });
    }

    // --- 11. FACTION API STATUS UPDATER ---
    async function updateFactionData() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        let activeFactions = new Set();
        document.querySelectorAll('a[href*="factions.php?step=profile&ID="]').forEach(a => {
            let m = a.href.match(/ID=(\d+)/);
            if (m) activeFactions.add(m[1]);
        });
        if (activeFactions.size === 0) activeFactions.add('');

        for (let fid of activeFactions) {
            let data = await fetchAPI(fid ? `https://api.torn.com/v2/faction/${fid}/members?key=${apiKey}` : `https://api.torn.com/v2/faction/members?key=${apiKey}`);
            if (data && data.members) {
                const ids = [];
                data.members.forEach(m => {
                    ids.push(m.id);
                    if (!memberData[m.id]) memberData[m.id] = {};
                    memberData[m.id].state = m.status.state;
                    memberData[m.id].until = m.status.until || 0;
                    memberData[m.id].desc = m.status.description || "";
                    memberData[m.id].activity = m.last_action && m.last_action.status
                        ? m.last_action.status.toLowerCase() : null;

                    if (m.status.state === "Hospital" && m.status.until) {
                        memberCountdowns[m.id] = { until: m.status.until, state: 'Hospital', desc: m.status.description };
                        setCachedStats(`hosp_${m.id}`, memberCountdowns[m.id]);
                    }
                });
                queueIdsForFetch(ids, true);
            }
        }
    }

    // --- 12. FLOATING CONTROLS & UPDATE CHECKER ---
    function checkForScriptUpdates(manual = false) {
        fetchAPI(SCRIPT_RAW_URL).then(text => {
            if (typeof text !== 'string') return;
            const match = text.match(/@version\s+([\d.]+)/);
            if (match) {
                const remoteVer = parseFloat(match[1]);
                if (remoteVer > SCRIPT_VERSION) {
                    if (confirm(`🚀 Newer Torn PDA Script Version Available: v${remoteVer} (Current: v${SCRIPT_VERSION})!\n\nTap OK to update automatically now.`)) {
                        window.location.href = SCRIPT_RAW_URL;
                    }
                } else if (manual) {
                    alert(`✅ Your Torn PDA War Sorter is up to date (v${SCRIPT_VERSION})!`);
                }
            }
        }).catch(() => {
            if (manual) alert("Could not connect to GitHub to check for updates.");
        });
    }

    function createMobileControls() {
        if (!PAGE.faction) return;
        if (document.querySelector('.tornpda-ctrl-container')) return;

        const ctrlContainer = document.createElement('div');
        ctrlContainer.className = 'tornpda-ctrl-container';

        const sortBtn = document.createElement('button');
        sortBtn.innerText = '⇅';
        sortBtn.className = 'tornpda-ctrl-btn';
        sortBtn.title = 'Cycle Sort Mode';

        const settingsBtn = document.createElement('button');
        settingsBtn.innerText = '⚙️';
        settingsBtn.className = 'tornpda-ctrl-btn';
        settingsBtn.title = 'Settings & Filters';

        ctrlContainer.appendChild(sortBtn);
        ctrlContainer.appendChild(settingsBtn);
        document.body.appendChild(ctrlContainer);

        // Settings Panel
        const panel = document.createElement('div');
        panel.className = 'tornpda-panel tornpda-hide';

        panel.innerHTML = `
            <div class="tornpda-panel-header">
                <span>⚔️ Torn PDA War Suite</span>
                <span class="tornpda-panel-close">✕</span>
            </div>
            <div class="tornpda-panel-label">Sort Preset</div>
            <select id="tornpda-sort-select">
                ${SORT_FIELDS.map(([val, label]) => `<option value="${val}" ${settings.sort.primaryField === val ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <div class="tornpda-panel-label">Stats Badge Placement</div>
            <select id="tornpda-badge-pos-select">
                <option value="under_name" ${settings.badgePos === 'under_name' ? 'selected' : ''}>Directly Under Name (Recommended)</option>
                <option value="col" ${settings.badgePos === 'col' ? 'selected' : ''}>Dedicated Column</option>
                <option value="inline" ${settings.badgePos === 'inline' ? 'selected' : ''}>Inline Beside Name</option>
            </select>
            <div class="tornpda-panel-label">Activity Filter</div>
            <label><input type="checkbox" data-group="activity" data-key="online" ${settings.activityFilter.online ? 'checked' : ''}> Online</label>
            <label><input type="checkbox" data-group="activity" data-key="idle" ${settings.activityFilter.idle ? 'checked' : ''}> Idle</label>
            <label><input type="checkbox" data-group="activity" data-key="offline" ${settings.activityFilter.offline ? 'checked' : ''}> Offline</label>
            <div class="tornpda-panel-label">Status Filter</div>
            <label><input type="checkbox" data-group="status" data-key="okay" ${settings.statusFilter.okay ? 'checked' : ''}> Okay</label>
            <label><input type="checkbox" data-group="status" data-key="hospital" ${settings.statusFilter.hospital ? 'checked' : ''}> Hospital</label>
            <label><input type="checkbox" data-group="status" data-key="traveling" ${settings.statusFilter.traveling ? 'checked' : ''}> Traveling</label>
            <button class="tornpda-action-btn tornpda-update-btn" id="tornpda-btn-update">🔄 Check for Updates (v${SCRIPT_VERSION})</button>
        `;

        document.body.appendChild(panel);

        panel.querySelector('.tornpda-panel-close').onclick = () => panel.classList.add('tornpda-hide');
        settingsBtn.onclick = (e) => {
            e.preventDefault();
            panel.classList.toggle('tornpda-hide');
        };

        sortBtn.onclick = (e) => {
            e.preventDefault();
            const modes = ['war_smart', 'stats_asc', 'stats_desc', 'none'];
            const curIdx = modes.indexOf(settings.sort.primaryField);
            const nextMode = modes[(curIdx + 1) % modes.length];
            settings.sort.primaryField = nextMode;
            saveSettings();
            panel.querySelector('#tornpda-sort-select').value = nextMode;
            sortAndFilterRoster();
        };

        panel.querySelector('#tornpda-sort-select').onchange = (e) => {
            settings.sort.primaryField = e.target.value;
            saveSettings();
            sortAndFilterRoster();
        };

        const posSelect = panel.querySelector('#tornpda-badge-pos-select');
        if (posSelect) {
            posSelect.onchange = (e) => {
                settings.badgePos = e.target.value;
                saveSettings();
                document.querySelectorAll('.tornpda-stats-badge, .tornpda-bs-col-cell, .tornpda-bs-header-cell').forEach(el => el.remove());
                document.querySelectorAll('.tornpda-name-col-wrap').forEach(wrap => {
                    const parent = wrap.parentNode;
                    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
                    wrap.remove();
                });
                sortAndFilterRoster();
            };
        }

        panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
            cb.onchange = (e) => {
                const grp = e.target.dataset.group === 'activity' ? settings.activityFilter : settings.statusFilter;
                grp[e.target.dataset.key] = e.target.checked;
                saveSettings();
                sortAndFilterRoster();
            };
        });

        panel.querySelector('#tornpda-btn-update').onclick = () => checkForScriptUpdates(true);
    }

    // --- 13. BOOT & PAGE HANDLERS ---
    if (PAGE.faction) {
        updateFactionData();
        createMobileControls();
        setInterval(updateFactionData, 20000);
        setInterval(sortAndFilterRoster, 1000);
    } else if (PAGE.attack) {
        initAttackPageHpTracker();
        setInterval(checkAndRenderAttackHospTimer, 1000);
        setInterval(updateAttackHpDisplay, 300);
    } else if (PAGE.profile) {
        const match = location.href.match(/XID=(\d+)/);
        if (match) {
            queueIdsForFetch([match[1]], true);
            setInterval(() => {
                const targetId = match[1];
                const m = memberData[targetId] || getCachedStats(targetId);
                if (m && !m.ffNoData) {
                    let line = document.getElementById('tornpda-profile-ff-line');
                    if (!line) {
                        const h4 = document.querySelector('h4');
                        if (h4) {
                            line = document.createElement('div');
                            line.id = 'tornpda-profile-ff-line';
                            h4.after(line);
                        }
                    }
                    if (line) {
                        const bsNum = m.bsEstimate || parseBsStringToNumber(m.bsEstimateHuman);
                        const threat = getTargetThreatInfo(bsNum, m.ff);
                        line.style.color = threat.bg;
                        line.style.fontWeight = 'bold';
                        line.style.fontSize = '13px';
                        line.textContent = `Est. Battle Stats: [ ${formatBattleStats(bsNum) || m.bsEstimateHuman} ] (Fair Fight: ${m.ff ? m.ff.toFixed(2) : 'N/A'})`;
                    }
                }
            }, 1000);
        }
    } else {
        // Generic badges for other pages (bounty, index, hospital, userlist, forums)
        setInterval(() => {
            const anchors = document.querySelectorAll('a[href*="XID="]');
            const ids = [];
            anchors.forEach(a => {
                const id = getPlayerIdFromElement(a);
                if (id) {
                    ids.push(id);
                    const m = memberData[id] || getCachedStats(id);
                    if (m && !m.ffNoData) {
                        let badge = a.parentElement?.querySelector('.tornpda-stats-badge');
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.className = 'tornpda-stats-badge';
                            a.after(badge);
                        }
                        renderStatsBadge(badge, m);
                    }
                }
            });
            if (ids.length > 0) queueIdsForFetch(ids, true);
        }, 1500);
    }

    window.__TORNPDA_WAR_ENHANCED_RECHECK__ = () => {
        if (PAGE.faction) {
            createMobileControls();
            sortAndFilterRoster();
        }
    };

    console.log(`[TornPDA War Sorter & FF Scouter v${SCRIPT_VERSION}] Loaded Successfully.`);
})();
