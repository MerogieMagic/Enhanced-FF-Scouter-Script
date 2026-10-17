// ==UserScript==
// @name         FF Scouter V2 + BS Threat Border + War Stuff Enhanced
// @namespace    Violentmonkey Scripts
// @match        https://www.torn.com/*
// @version      3.06
// @author       rDacted, Weav3r, xentac - modded by Merogie & Antigravity
// @description  Combines Battle Stats Threat Borders, Est. BS sorting, Travel Status, Hospitalization Timers & Smart War Sorting
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      ffscouter.com
// @connect      api.torn.com
// @connect      twse.dev
// @connect      raw.githubusercontent.com
// @downloadURL https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/ff_scouter_bs_enhanced.user.js
// @updateURL https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/ff_scouter_bs_enhanced.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = "3.06";
    const SCRIPT_RAW_URL = "https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/ff_scouter_bs_enhanced.user.js";
    const API_INTERVAL = 15000; // 15s refresh for war/faction API status
    const BASE_FF_URL = "https://ffscouter.com";

    function isListingPage() {
        return typeof window !== "undefined" && !!window.location && (window.location.href.includes("step=listing") || window.location.href.includes("step=search"));
    }

    // Global in-memory caches
    const memberCountdowns = {}; // userID -> { until: unixSec, state: string, desc: string, lastAction: string }
    const memberStatusMap = {};   // userID -> parsed member object from Torn API
    const memberLastAction = {};  // userID -> last action string
    const targetLifeData = {};    // targetID -> { current: number, maximum: number, name: string }
    let myMaxHp = null;
    let apiCallInProgress = false;

    // --- PDA / GM API Polyfills ---
    const isPDA = typeof window !== "undefined" && !!window.flutter_inappwebview;
    
    function rD_xmlhttpRequest(details) {
        if (typeof GM_xmlhttpRequest !== "undefined") {
            return GM_xmlhttpRequest(details);
        }
        if (isPDA && window.PDA_httpGet) {
            if (details.method?.toLowerCase() === "get") {
                return PDA_httpGet(details.url).then(details.onload).catch(details.onerror || console.error);
            } else if (details.method?.toLowerCase() === "post") {
                return PDA_httpPost(details.url, details.headers || {}, details.body || details.data || "").then(details.onload).catch(details.onerror || console.error);
            }
        }
        return fetch(details.url, {
            method: details.method || "GET",
            headers: details.headers,
            body: details.body || details.data
        }).then(async res => {
            const text = await res.text();
            if (details.onload) details.onload({ status: res.status, responseText: text });
        }).catch(details.onerror || console.error);
    }

    function rD_setValue(name, value) {
        if (typeof GM_setValue !== "undefined") {
            GM_setValue(name, value);
        }
        try { localStorage.setItem("ff_twse_" + name, value); } catch (e) {}
    }

    function rD_getValue(name, defaultValue) {
        if (typeof GM_getValue !== "undefined") {
            const v = GM_getValue(name);
            if (v !== undefined && v !== null) return v;
        }
        try {
            const v = localStorage.getItem("ff_twse_" + name) || localStorage.getItem(name);
            if (v !== null && v !== undefined) return v;
        } catch (e) {}
        return defaultValue;
    }

    function rD_deleteValue(name) {
        if (typeof GM_deleteValue !== "undefined") {
            GM_deleteValue(name);
        }
        try { localStorage.removeItem("ff_twse_" + name); } catch (e) {}
    }

    // --- Current Account & API Key Management ---
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

    function clearEvaluationCache() {
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('ff_twse_') || k.startsWith('ffscouter_')) localStorage.removeItem(k);
            });
        } catch (e) {}
    }

    const currentUserId = getCurrentUserId();
    const keyStorageName = currentUserId ? `limited_key_${currentUserId}` : 'limited_key';
    let apiKey = rD_getValue(keyStorageName, null) || rD_getValue("limited_key", null) || rD_getValue("torn_api_key", null) || localStorage.getItem("twse-config-apikey") || "";
    if (apiKey === '###PDA-APIKEY###' || apiKey.startsWith('###')) {
        apiKey = "";
    }

    let myTotalBattleStats = parseFloat(rD_getValue(currentUserId ? `my_bs_${currentUserId}` : 'my_bs', '0')) || null;

    async function fetchMyBattleStats() {
        if (!apiKey) return;
        try {
            const needBs = !myTotalBattleStats;
            const needHp = !rD_getValue(currentUserId ? `my_max_hp_${currentUserId}` : 'my_max_hp');
            if (!needBs && !needHp) return;

            const url = `https://api.torn.com/user/?selections=battlestats,bars&key=${apiKey}&comment=FFScouterSelf`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data && data.total) {
                    myTotalBattleStats = data.total;
                    if (currentUserId) rD_setValue(`my_bs_${currentUserId}`, String(data.total));
                    rD_setValue('my_bs', String(data.total));
                }
                if (data && data.life && data.life.maximum) {
                    const hp = parseInt(data.life.maximum, 10);
                    if (hp > 0) {
                        myMaxHp = hp;
                        if (currentUserId) rD_setValue(`my_max_hp_${currentUserId}`, String(hp));
                        rD_setValue('my_max_hp', String(hp));
                    }
                }
            }
        } catch (e) {}
    }

    function setApiKey(newKey) {
        if (newKey !== null) {
            newKey = newKey.trim();
            apiKey = newKey;
            if (currentUserId) rD_setValue(`limited_key_${currentUserId}`, newKey);
            rD_setValue('limited_key', newKey);
            rD_setValue('torn_api_key', newKey);
            try { localStorage.setItem("twse-config-apikey", newKey); } catch(e){}
            myTotalBattleStats = null;
            if (currentUserId) rD_deleteValue(`my_bs_${currentUserId}`);
            rD_deleteValue('my_bs');
            clearEvaluationCache();
            fetchMyBattleStats();
            window.location.reload();
        }
    }

    // --- Version & Update Checker ---
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
            showToast("🔍 Checking GitHub for updates...");
        }

        const cacheBuster = `?t=${Date.now()}`;
        rD_xmlhttpRequest({
            method: "GET",
            url: `${SCRIPT_RAW_URL}${cacheBuster}`,
            headers: {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            },
            onload: function (response) {
                try {
                    if (response.status !== 200 || !response.responseText) {
                        if (manual) showToast(`❌ Update check failed (HTTP ${response.status})`);
                        return;
                    }
                    const versionMatch = response.responseText.match(/@version\s+([0-9.]+)/i);
                    if (!versionMatch || !versionMatch[1]) {
                        if (manual) showToast("❌ Could not parse remote script version.");
                        return;
                    }
                    const remoteVersion = versionMatch[1].trim();
                    rD_setValue('last_update_check_time', String(Date.now()));

                    if (isNewerVersion(remoteVersion, SCRIPT_VERSION)) {
                        const confirmed = confirm(
                            `🚀 A new version of FF Scouter & War Stuff Enhanced is available!\n\n` +
                            `Current Version: v${SCRIPT_VERSION}\n` +
                            `Latest Version:  v${remoteVersion}\n\n` +
                            `Click OK to open Tampermonkey installer and update now.`
                        );
                        if (confirmed) {
                            showToast(`🚀 Opening v${remoteVersion} installer...`);
                            window.open(SCRIPT_RAW_URL, '_blank');
                        }
                    } else {
                        if (manual) {
                            showToast(`✅ You are using the latest version (v${SCRIPT_VERSION})!`);
                        }
                    }
                } catch (e) {
                    console.error("[FF Scouter] Update check parsing error:", e);
                    if (manual) showToast(`❌ Error checking for updates: ${e.message}`);
                }
            },
            onerror: function (err) {
                console.error("[FF Scouter] Update check network error:", err);
                if (manual) showToast("❌ Network error while checking for updates.");
            }
        });
    }

    function autoCheckForUpdates() {
        const lastCheck = parseInt(rD_getValue('last_update_check_time', '0'), 10) || 0;
        const now = Date.now();
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        if (now - lastCheck > TWENTY_FOUR_HOURS) {
            checkForScriptUpdates(false);
        }
    }

    if (typeof GM_registerMenuCommand !== "undefined") {
        GM_registerMenuCommand('🔄 Check for Script Updates', () => {
            checkForScriptUpdates(true);
        });
        GM_registerMenuCommand('🔑 Set / Change Torn & FF Scouter API Key', () => {
            let userInput = prompt(`Enter Torn API Key for ${currentUserId ? `Account [${currentUserId}]` : 'your account'}:`, apiKey);
            setApiKey(userInput);
        });

        GM_registerMenuCommand('🎯 Set / Calibrate My Battle Stats (Optional)', () => {
            const currentFormatted = myTotalBattleStats ? formatBattleStats(myTotalBattleStats) : 'Auto';
            let userInput = prompt(`Enter your Total Battle Stats (e.g. 200, 50k, 25m, 26b) for relative scaling:\n(Leave blank to auto-detect via API)`, currentFormatted);
            if (userInput !== null) {
                userInput = userInput.trim();
                const parsed = parseBsStringToNumber(userInput);
                if (parsed && parsed > 0) {
                    myTotalBattleStats = parsed;
                    if (currentUserId) rD_setValue(`my_bs_${currentUserId}`, String(parsed));
                    rD_setValue('my_bs', String(parsed));
                    showToast(`My Battle Stats calibrated to ~${formatBattleStats(parsed)}`);
                } else {
                    myTotalBattleStats = null;
                    if (currentUserId) rD_deleteValue(`my_bs_${currentUserId}`);
                    rD_deleteValue('my_bs');
                    showToast("Battle stats set to Auto-Detect via API.");
                    fetchMyBattleStats();
                }
                clearEvaluationCache();
                window.location.reload();
            }
        });

        GM_registerMenuCommand('🗑️ Clear Cached Stats & Reset Key', () => {
            if (confirm("Clear stored API key and all cached player stat evaluations?")) {
                apiKey = "";
                myTotalBattleStats = null;
                if (currentUserId) {
                    rD_deleteValue(`limited_key_${currentUserId}`);
                    rD_deleteValue(`my_bs_${currentUserId}`);
                }
                rD_deleteValue('limited_key');
                rD_deleteValue('torn_api_key');
                rD_deleteValue('my_bs');
                try { localStorage.removeItem("twse-config-apikey"); } catch(e){}
                clearEvaluationCache();
                showToast("Cache and API key cleared!");
                window.location.reload();
            }
        });

        GM_registerMenuCommand('⏱️ Toggle Smart War Hosp Auto-Sort', () => {
            const current = rD_getValue('auto_war_sort', 'true') === 'true';
            rD_setValue('auto_war_sort', (!current).toString());
            showToast(`Smart War Auto-Sort ${!current ? 'Enabled' : 'Disabled'}`);
        });

        GM_registerMenuCommand('📋 Toggle 1-Click ID Copy Buttons', () => {
            const current = rD_getValue('copy_buttons_enabled', 'true') === 'true';
            rD_setValue('copy_buttons_enabled', (!current).toString());
            showToast(`Quick Copy Buttons ${!current ? 'Enabled' : 'Disabled'}`);
            window.location.reload();
        });

        GM_registerMenuCommand('🎯 Set / Change Emergency Chain Target ID', () => {
            let current = rD_getValue('emergency_hit_target', '');
            if (current === '4' || current === '15') current = '';
            const input = prompt("Enter Default / Fallback Emergency Target ID (e.g. 1776074, 1999595, or an easy level holder):\n(Leave blank to clear and rely on Ranked War enemies & curated 1-hit targets)", current);
            if (input !== null) {
                const trimmed = input.trim();
                if (trimmed === '4' || trimmed === '15') {
                    alert("⚠️ Duke [4] and Leslie [15] are massive loot bosses (5.5M HP) and cannot be used as easy 1-hit chain targets!");
                    return;
                }
                if (/^\d+$/.test(trimmed)) {
                    rD_setValue('emergency_hit_target', trimmed);
                    showToast(`Emergency Chain Target set to [${trimmed}]`);
                } else {
                    rD_deleteValue('emergency_hit_target');
                    showToast("Emergency Chain Target cleared (using active Ranked War enemies & 1-hit punching bags).");
                }
            }
        });

        GM_registerMenuCommand('📋 Manage Custom Chain Target List', () => {
            manageCustomTargetList();
        });

        GM_registerMenuCommand('📥 Fetch / Refresh FF Scouter Innate Target List', () => {
            fetchFFScouterTargets(true);
        });
    }

    // --- Inject Styles ---
    GM_addStyle(`
        /* Force total removal and invisibility of legacy arrows and redundant estimate tags */
        .ff-scouter-arrow,
        img[class*="ff-scouter-arrow"],
        img[src*="arrow.svg"],
        img[src*="blue-arrow"],
        img[src*="green-arrow"],
        img[src*="red-arrow"],
        .indicator-lines::before,
        .indicator-lines::after,
        .ff-scouter-bs-estimate,
        [class*="stats-estimate"],
        [class*="bs-estimate"],
        .torn-tools-estimate {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            pointer-events: none !important;
        }

        /* Global complete suppression of ANY raw FF cells/headers */
        .table-header .ff:not(.ff-bs-col),
        .table-header .table-cell.ff:not(.ff-bs-col),
        [class*="tableHeader"] .ff:not(.ff-bs-col),
        [class*="tableHeader"] .table-cell.ff:not(.ff-bs-col),
        .table-row .ff:not(.ff-bs-col),
        .table-row .table-cell.ff:not(.ff-bs-col),
        .table-body .ff:not(.ff-bs-col),
        .table-body .table-cell.ff:not(.ff-bs-col),
        .members-list .ff:not(.ff-bs-col),
        .members-list .table-cell.ff:not(.ff-bs-col),
        [class*="tableBody"] .ff:not(.ff-bs-col),
        [class*="membersList"] .ff:not(.ff-bs-col),
        li.table-cell.ff:not(.ff-bs-col),
        li.ff:not(.ff-bs-col),
        div.ff:not(.ff-bs-col) {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            pointer-events: none !important;
        }

        .table-cell { overflow: hidden; }
        .table-cell.member,
        .table-row .member,
        .member,
        .honor-text-wrap {
            overflow: visible !important;
        }

        .table-cell.member .honor-text-wrap {
            max-width: calc(100% - 2px) !important;
            overflow: visible !important;
        }

        /* Dedicated Est. BS Column for Faction Member Lists */
        .table-cell.ff-bs-col {
            width: 52px !important;
            min-width: 48px !important;
            max-width: 60px !important;
            text-align: center !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-weight: 700 !important;
            font-size: 11.5px !important;
            color: #ffffff !important;
            box-sizing: border-box !important;
            padding: 0 2px !important;
            border-radius: 3px !important;
            margin: 1px 2px !important;
        }

        .table-header .table-cell.ff-bs-col {
            background: transparent !important;
            color: #cccccc !important;
            font-weight: bold !important;
            font-size: 12px !important;
            cursor: pointer !important;
            box-shadow: none !important;
            border: none !important;
        }

        .ff-scouter-indicator {
            position: relative;
            box-sizing: border-box !important;
            border: 2px solid var(--ff-border-color, transparent) !important;
            border-radius: 4px !important;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .ff-scouter-indicator[data-ff-threat] {
            box-shadow: 0 0 4px var(--ff-border-glow, rgba(0, 0, 0, 0.35)) !important;
        }

        a.ff-scouter-indicator {
            display: inline-block !important;
            padding: 0 4px !important;
            vertical-align: middle;
        }

        .ff-scouter-bs-badge {
            position: absolute !important;
            bottom: 0px !important;
            right: 0px !important;
            font-size: 9px !important;
            line-height: 9.5px !important;
            color: #ffffff !important;
            background-color: var(--ff-badge-bg, rgba(0, 0, 0, 0.92)) !important;
            opacity: 0.95 !important;
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
            padding: 0px 3px 1px 3px !important;
            border-top-left-radius: 3px !important;
            border-bottom-right-radius: 2px !important;
            border-top-right-radius: 0px !important;
            border-bottom-left-radius: 0px !important;
            pointer-events: none !important;
            z-index: 10 !important;
            font-weight: 800 !important;
            white-space: nowrap !important;
            letter-spacing: 0.2px;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
        }

        .ff-scouter-indicator.compact .ff-scouter-bs-badge,
        .dataGridRow___FAAJF .ff-scouter-bs-badge {
            font-size: 8px !important;
            line-height: 8.5px !important;
            padding: 0 2px !important;
            bottom: 0px !important;
            right: 0px !important;
        }

        /* Status Column Styles (Non-Destructive, Single-Line) */
        .status, .table-cell.status {
            overflow: visible !important;
            white-space: nowrap !important;
            text-align: center !important;
            font-size: 11px !important;
        }

        .travel-status-badge {
            display: inline-block !important;
            vertical-align: middle !important;
            font-size: 10.5px !important;
            font-weight: 600 !important;
            line-height: 14px !important;
            padding: 1px 5px !important;
            border-radius: 3px !important;
            white-space: nowrap !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
        }

        /* Yellow box for all traveling flights (Incoming & Outgoing) */
        .travel-status-badge.traveling,
        .travel-status-badge.incoming,
        .travel-status-badge.outgoing {
            background: rgba(245, 158, 11, 0.25) !important;
            border: 1px solid rgba(245, 158, 11, 0.5) !important;
            color: #fbbf24 !important;
        }

        /* Blue box for overseas / abroad (No airplane icon) */
        .travel-status-badge.abroad {
            background: rgba(59, 130, 246, 0.25) !important;
            border: 1px solid rgba(59, 130, 246, 0.5) !important;
            color: #60a5fa !important;
        }

        .hosp-timer-badge {
            display: inline-block !important;
            vertical-align: middle !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            font-family: monospace, monospace !important;
            line-height: 14px !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            color: #f87171 !important;
            background: rgba(220, 38, 38, 0.15) !important;
            border: 1px solid rgba(220, 38, 38, 0.35) !important;
            white-space: nowrap !important;
            box-sizing: border-box !important;
            text-decoration: none !important;
            cursor: pointer !important;
            transition: transform 0.1s ease, filter 0.15s ease, box-shadow 0.15s ease !important;
        }

        .hosp-timer-badge:hover {
            filter: brightness(1.25) !important;
            transform: scale(1.05) !important;
            box-shadow: 0 0 5px rgba(220, 38, 38, 0.6) !important;
        }

        .hosp-timer-badge.near-expiry {
            color: #22c55e !important;
            background: rgba(34, 197, 94, 0.25) !important;
            border-color: #22c55e !important;
            font-weight: 800 !important;
            animation: hosp-glow 1.4s infinite ease-in-out !important;
        }

        .hosp-timer-badge.unexpected-okay {
            color: #38bdf8 !important;
            background: rgba(56, 189, 248, 0.25) !important;
            border-color: #38bdf8 !important;
            animation: hosp-glow 0.8s infinite ease-in-out !important;
        }

        @keyframes hosp-glow {
            0% { box-shadow: 0 0 2px rgba(34, 197, 94, 0.3); }
            50% { box-shadow: 0 0 6px rgba(34, 197, 94, 0.8); }
            100% { box-shadow: 0 0 2px rgba(34, 197, 94, 0.3); }
        }

        /* Attack Screen Hospital Timer Banner */
        .ff-attack-hosp-banner {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            margin: 4px 0 8px 0 !important;
            padding: 4px 10px !important;
            border-radius: 4px !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            background: rgba(220, 38, 38, 0.2) !important;
            border: 1px solid rgba(220, 38, 38, 0.5) !important;
            color: #fca5a5 !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3) !important;
            clear: both !important;
        }

        .ff-attack-hosp-banner.near-expiry {
            background: rgba(234, 88, 12, 0.25) !important;
            border-color: #f97316 !important;
            color: #fdba74 !important;
            animation: hosp-glow 1.2s infinite ease-in-out !important;
        }

        .ff-attack-hosp-banner.discharged {
            background: rgba(34, 197, 94, 0.25) !important;
            border-color: #22c55e !important;
            color: #86efac !important;
            animation: hosp-glow 0.8s infinite ease-in-out !important;
        }

        .ff-attack-hosp-timer {
            font-family: monospace, monospace !important;
            font-size: 13.5px !important;
            font-weight: 800 !important;
            letter-spacing: 0.5px !important;
        }

        /* Attack Screen Model Overlay Countdown Box */
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
            font-size: 22px !important;
            font-weight: 900 !important;
            font-family: monospace, monospace !important;
            color: #f87171 !important;
            letter-spacing: 1.5px !important;
            text-shadow: 0 0 10px rgba(239, 68, 68, 0.85) !important;
            line-height: 24px !important;
        }

        .ff-countdown-digits.near-expiry {
            color: #4ade80 !important;
            text-shadow: 0 0 10px rgba(74, 222, 128, 0.85) !important;
            animation: hosp-glow 1s infinite ease-in-out !important;
        }

        .ff-countdown-label {
            font-size: 10px !important;
            font-weight: 700 !important;
            color: #cbd5e1 !important;
            letter-spacing: 0.8px !important;
            text-transform: uppercase !important;
            margin-top: 3px !important;
        }

        /* 1-Click Copy Fast Button */
        .twse-copy-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 12px !important;
            height: 12px !important;
            margin-left: 3px !important;
            cursor: pointer !important;
            opacity: 0.45 !important;
            transition: opacity 0.15s ease !important;
            vertical-align: middle !important;
            color: #cbd5e1 !important;
            flex-shrink: 0 !important;
        }
        .twse-copy-btn:hover {
            opacity: 1 !important;
            color: #38bdf8 !important;
        }

        /* Simple (hp / maxhp) next to player name (0% layout distortion) */
        .ff-player-hp-simple {
            display: inline !important;
            font-size: 0.88em !important;
            font-weight: 600 !important;
            margin-left: 6px !important;
            letter-spacing: 0.2px !important;
            white-space: nowrap !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9) !important;
            pointer-events: none !important;
            vertical-align: baseline !important;
        }

        .ff-player-hp-badge,
        .ff-attack-hp-hud,
        .ff-life-bar-text {
            display: none !important;
        }

        @keyframes ffExecuteGlow {
            0% { box-shadow: 0 0 3px #ef4444; }
            50% { box-shadow: 0 0 10px #ef4444, 0 0 4px #dc2626; }
            100% { box-shadow: 0 0 3px #ef4444; }
        }

        @media (max-width: 600px) {
            .ff-attack-hp-hud {
                padding: 4px 8px !important;
                font-size: 11px !important;
                gap: 4px !important;
            }
            .ff-hud-fighter {
                font-size: 11px !important;
            }
            .ff-hud-hp-pill {
                font-size: 10.5px !important;
                padding: 1px 5px !important;
            }
            .ff-player-hp-badge {
                font-size: 10px !important;
                padding: 1px 5px !important;
            }
        }

        .ff-scouter-mini-ff {
            padding: 0px 5px 2px;
        }

        /* Non-destructive Flexbox Battle Stats & Hosp Sorting */
        .members-list.ff-flex-sort,
        .table-body.ff-flex-sort,
        [class*="membersList"].ff-flex-sort,
        [class*="tableBody"].ff-flex-sort,
        ul.ff-flex-sort,
        .ff-flex-sort {
            display: flex !important;
            flex-direction: column !important;
        }

        .ff-war-sort-toolbar {
            display: flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 3px !important;
            padding: 2px 4px !important;
            margin: 2px 0 4px 0 !important;
            background: linear-gradient(180deg, #2b2b2b 0%, #1e1e1e 100%) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 4px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
            box-sizing: border-box !important;
            user-select: none !important;
            z-index: 5 !important;
            width: 100% !important;
            max-width: 100% !important;
        }

        .ff-sort-title {
            font-size: 10.5px !important;
            font-weight: 700 !important;
            color: #e2e8f0 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.4px !important;
            margin-right: 2px !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 2px !important;
        }

        .ff-sort-btn {
            background: #333333 !important;
            color: #cbd5e1 !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important;
            border-radius: 3px !important;
            padding: 1px 6px !important;
            font-size: 10px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 2px !important;
            line-height: 13px !important;
        }

        .ff-sort-btn:hover {
            background: #444444 !important;
            color: #ffffff !important;
            border-color: rgba(255, 255, 255, 0.35) !important;
        }

        .ff-sort-btn.active.ff-sort-war {
            background: rgba(234, 88, 12, 0.25) !important;
            border-color: #ea580c !important;
            color: #fb923c !important;
            box-shadow: 0 0 5px rgba(234, 88, 12, 0.4) !important;
        }

        .ff-sort-btn.active.ff-sort-asc {
            background: rgba(34, 197, 94, 0.25) !important;
            border-color: #22c55e !important;
            color: #4ade80 !important;
            box-shadow: 0 0 5px rgba(34, 197, 94, 0.4) !important;
        }

        .ff-sort-btn.active.ff-sort-desc {
            background: rgba(220, 38, 38, 0.25) !important;
            border-color: #dc2626 !important;
            color: #f87171 !important;
            box-shadow: 0 0 5px rgba(220, 38, 38, 0.4) !important;
        }

        .ff-sort-btn.active.ff-sort-reset {
            background: rgba(148, 163, 184, 0.2) !important;
            border-color: #94a3b8 !important;
            color: #f1f5f9 !important;
        }

        .ff-sortable-header:hover {
            color: #38bdf8 !important;
            text-shadow: 0 0 3px rgba(56, 189, 248, 0.4) !important;
        }
    `);

    // --- Singleton & Profile Info Line ---
    let info_line = null;
    function create_text_location() {
        if (document.getElementById('ff-scouter-run-once')) return;
        info_line = document.createElement('div');
        info_line.id = "ff-scouter-run-once";
        info_line.style.display = 'block';
        info_line.style.clear = 'both';
        info_line.style.margin = '5px 0';
        info_line.addEventListener('click', () => {
            if (!apiKey) {
                const inputKey = prompt(`Enter Torn API Key for ${currentUserId ? `Account [${currentUserId}]` : 'your account'}:`, "");
                setApiKey(inputKey);
            }
        });

        const h4 = $("h4")[0];
        if (!h4) {
            info_line.style.display = 'none';
            document.body.appendChild(info_line);
            return info_line;
        }

        const linksTopWrap = (h4.parentNode && h4.parentNode.querySelector('.links-top-wrap')) || document.querySelector('.links-top-wrap');
        if (linksTopWrap) {
            linksTopWrap.parentNode.insertBefore(info_line, linksTopWrap.nextSibling);
            info_line.style.margin = '4px 0 10px 0';
        } else if (h4.textContent === "Attacking" && h4.parentNode && h4.parentNode.parentNode) {
            h4.parentNode.parentNode.after(info_line);
            info_line.style.margin = '4px 0 10px 0';
        } else {
            h4.after(info_line);
            info_line.style.margin = '5px 0';
        }
        return info_line;
    }

    function set_message(message, error = false) {
        if (!info_line) return;
        while (info_line.firstChild) {
            info_line.removeChild(info_line.firstChild);
        }
        const textNode = document.createTextNode(message);
        info_line.style.color = error ? "red" : "";
        info_line.appendChild(textNode);
        info_line.style.display = 'block';
    }

    // --- Battle Stats Cache & Threat System ---
    function update_ff_cache(player_ids, callback) {
        if (!apiKey) return;
        player_ids = [...new Set(player_ids)];
        const unknown_player_ids = get_cache_misses(player_ids);

        if (unknown_player_ids.length > 0) {
            const player_id_list = unknown_player_ids.join(",");
            const url = `${BASE_FF_URL}/api/v1/get-stats?key=${apiKey}&targets=${player_id_list}`;

            rD_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function (response) {
                    if (response.status === 200) {
                        try {
                            const ff_response = JSON.parse(response.responseText);
                            if (ff_response && ff_response.error) {
                                showToast(ff_response.error);
                                return;
                            }
                            const one_hour = 60 * 60 * 1000;
                            const expiry = Date.now() + one_hour;
                            ff_response.forEach(result => {
                                if (result && result.player_id) {
                                    if (result.fair_fight === null && result.bs_estimate === null && result.bs_estimate_human === null && result.last_updated === null) {
                                        rD_setValue("" + result.player_id, JSON.stringify({ no_data: true, expiry: expiry }));
                                    } else {
                                        rD_setValue("" + result.player_id, JSON.stringify({
                                            value: result.fair_fight,
                                            last_updated: result.last_updated,
                                            expiry: expiry,
                                            bs_estimate: result.bs_estimate,
                                            bs_estimate_human: result.bs_estimate_human
                                        }));
                                    }
                                }
                            });
                            if (callback) callback(player_ids);
                        } catch (e) {
                            console.error("Error parsing FF response", e);
                        }
                    }
                },
                onerror: function (e) { console.error('FF API Error', e); }
            });
        } else {
            if (callback) callback(player_ids);
        }
    }

    function get_cache_misses(player_ids) {
        const unknown_player_ids = [];
        for (const player_id of player_ids) {
            let cached = rD_getValue("" + player_id, null);
            try { cached = JSON.parse(cached); } catch { cached = null; }
            if (!cached || cached.expiry < Date.now()) {
                unknown_player_ids.push(player_id);
            }
        }
        return unknown_player_ids;
    }

    function get_fair_fight_response(target_id) {
        let cached = rD_getValue("" + target_id, null);
        try { cached = JSON.parse(cached); } catch { cached = null; }
        if (cached && cached.expiry > Date.now()) {
            return cached;
        }
        return null;
    }

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

    function format3SigFigs(val) {
        if (val >= 99.95) return Math.round(val).toString();
        if (val >= 9.995) return val.toFixed(1);
        return val.toFixed(2);
    }

    function formatBattleStats(value) {
        if (!value) return null;
        let num = value;
        if (typeof num === 'string') num = parseBsStringToNumber(num);
        if (typeof num !== 'number' || isNaN(num) || num <= 0) {
            if (typeof value === 'string') return value.toLowerCase();
            return null;
        }
        if (num >= 1e12) return format3SigFigs(num / 1e12) + 't';
        if (num >= 1e9) return format3SigFigs(num / 1e9) + 'b';
        if (num >= 1e6) return format3SigFigs(num / 1e6) + 'm';
        if (num >= 1e3) return format3SigFigs(num / 1e3) + 'k';
        return Math.round(num).toString();
    }

    function get_target_threat_info(response) {
        if (!response) return null;
        if (response.no_data) {
            return {
                tier: 'unrated',
                color: 'rgba(160, 160, 160, 0.4)',
                glow: 'rgba(160, 160, 160, 0.15)',
                badgeBg: 'rgba(60, 60, 60, 0.92)',
                tooltip: 'Est. BS: Unrated / No Data'
            };
        }

        let bsNum = null;
        if (typeof response.bs_estimate === 'number' && response.bs_estimate > 0) {
            bsNum = response.bs_estimate;
        } else if (typeof response.bs_estimate_human === 'string') {
            bsNum = parseBsStringToNumber(response.bs_estimate_human);
        }

        const ff = typeof response.value === 'number' ? response.value : null;
        const formattedBs = bsNum !== null ? `Est. BS: ~${formatBattleStats(bsNum)}` : (ff !== null ? `FF: ${ff.toFixed(2)}` : 'Unrated');

        // 1. Primary Scaling: Relative Fair Fight (FF) Multiplier (Scales to active account)
        if (ff !== null) {
            if (ff < 1.5) {
                return {
                    tier: 'very_easy',
                    color: '#38bdf8',
                    glow: 'rgba(56, 189, 248, 0.45)',
                    badgeBg: 'rgba(56, 189, 248, 0.92)',
                    tooltip: `${formattedBs} (FF: ${ff.toFixed(2)} • Very Easy Target)`
                };
            } else if (ff < 2.2) {
                return {
                    tier: 'easy',
                    color: '#2563eb',
                    glow: 'rgba(37, 99, 235, 0.45)',
                    badgeBg: 'rgba(37, 99, 235, 0.92)',
                    tooltip: `${formattedBs} (FF: ${ff.toFixed(2)} • Easy Match)`
                };
            } else if (ff < 3.2) {
                return {
                    tier: 'moderate',
                    color: '#4ade80',
                    glow: 'rgba(74, 222, 128, 0.45)',
                    badgeBg: 'rgba(74, 222, 128, 0.92)',
                    tooltip: `${formattedBs} (FF: ${ff.toFixed(2)} • Moderate Match)`
                };
            } else if (ff < 4.2) {
                return {
                    tier: 'mod_difficult',
                    color: '#f97316',
                    glow: 'rgba(249, 115, 22, 0.45)',
                    badgeBg: 'rgba(249, 115, 22, 0.92)',
                    tooltip: `${formattedBs} (FF: ${ff.toFixed(2)} • Moderate Challenge)`
                };
            } else {
                return {
                    tier: 'cannot_win',
                    color: '#dc2626',
                    glow: 'rgba(220, 38, 38, 0.55)',
                    badgeBg: 'rgba(220, 38, 38, 0.92)',
                    tooltip: `${formattedBs} (FF: ${ff.toFixed(2)} • Cannot Win - Skip!)`
                };
            }
        }

        // 2. Relative Ratio Scaling when user's own battle stats are known
        if (bsNum !== null && myTotalBattleStats && myTotalBattleStats > 0) {
            const ratio = bsNum / myTotalBattleStats;
            if (ratio < 0.25) {
                return { tier: 'very_easy', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)', badgeBg: 'rgba(56, 189, 248, 0.92)', tooltip: `${formattedBs} (${(ratio * 100).toFixed(0)}% of your stats • Very Easy)` };
            } else if (ratio < 0.75) {
                return { tier: 'easy', color: '#2563eb', glow: 'rgba(37, 99, 235, 0.45)', badgeBg: 'rgba(37, 99, 235, 0.92)', tooltip: `${formattedBs} (${(ratio * 100).toFixed(0)}% of your stats • Easy Match)` };
            } else if (ratio < 1.35) {
                return { tier: 'moderate', color: '#4ade80', glow: 'rgba(74, 222, 128, 0.45)', badgeBg: 'rgba(74, 222, 128, 0.92)', tooltip: `${formattedBs} (${(ratio * 100).toFixed(0)}% of your stats • Moderate Match)` };
            } else if (ratio < 2.50) {
                return { tier: 'mod_difficult', color: '#f97316', glow: 'rgba(249, 115, 22, 0.45)', badgeBg: 'rgba(249, 115, 22, 0.92)', tooltip: `${formattedBs} (${ratio.toFixed(1)}x your stats • Challenging)` };
            } else {
                return { tier: 'cannot_win', color: '#dc2626', glow: 'rgba(220, 38, 38, 0.55)', badgeBg: 'rgba(220, 38, 38, 0.92)', tooltip: `${formattedBs} (${ratio.toFixed(1)}x your stats • Cannot Win - Skip!)` };
            }
        }

        // 3. Fallback: Unrated when neither FF nor user stats are available
        if (bsNum !== null) {
            return {
                tier: 'unrated',
                color: 'rgba(160, 160, 160, 0.4)',
                glow: 'rgba(160, 160, 160, 0.15)',
                badgeBg: 'rgba(60, 60, 60, 0.92)',
                tooltip: `${formattedBs} (Set API Key or calibrate stats for relative scaling)`
            };
        }

        return null;
    }

    function get_difficulty_text(ff) {
        if (!ff) return "Unknown";
        if (ff <= 1) return "Extremely easy";
        if (ff <= 2) return "Easy";
        if (ff <= 3.5) return "Moderately difficult";
        if (ff <= 4.5) return "Difficult";
        return "May be impossible";
    }

    function get_detailed_message(ff_response) {
        if (ff_response.no_data) {
            return `<span style="font-weight: bold; margin-right: 6px;">Battle Stats:</span><span style="background: #444; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px; display: inline-block;">No data</span>`;
        }
        const difficulty = get_difficulty_text(ff_response.value);
        const age = (Date.now() / 1000) - (ff_response.last_updated || 0);
        let fresh = "";
        if (age >= 365 * 24 * 3600) fresh = `(${Math.round(age / (365 * 24 * 3600))}y old)`;
        else if (age >= 31 * 24 * 3600) fresh = `(${Math.round(age / (31 * 24 * 3600))}mo old)`;
        else if (age >= 24 * 3600) fresh = `(${Math.round(age / (24 * 3600))}d old)`;

        const threat = get_target_threat_info(ff_response);
        const bgColour = threat?.badgeBg || threat?.color || '#444';
        const rawBs = ff_response.bs_estimate || ff_response.bs_estimate_human;
        const bsDisplay = rawBs ? formatBattleStats(rawBs) : (ff_response.value ? `~${Math.round(ff_response.value)}` : '-');

        return `<span style="font-weight: bold; margin-right: 6px;">Battle Stats:</span><span style="background: ${bgColour}; color: #ffffff; font-weight: bold; padding: 2px 8px; border-radius: 4px; display: inline-block; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">${bsDisplay} (${difficulty}) ${fresh}</span>`;
    }

    function display_fair_fight(target_id) {
        const response = get_fair_fight_response(target_id);
        if (response && info_line) {
            info_line.innerHTML = get_detailed_message(response);
            info_line.style.display = 'block';
        }
    }

    // --- Country Abbreviations & Time Formatting ---
    const countryAbbrMap = {
        "argentina": "Argentina",
        "canada": "Canada",
        "cayman islands": "Cayman",
        "cayman": "Cayman",
        "china": "China",
        "hawaii": "Hawaii",
        "japan": "Japan",
        "mexico": "Mexico",
        "south africa": "Africa",
        "switzerland": "Switz",
        "uae": "UAE",
        "united arab emirates": "UAE",
        "united kingdom": "UK",
        "uk": "UK"
    };

    function abbreviateCountry(name) {
        if (!name) return '';
        const clean = name.trim().toLowerCase();
        if (countryAbbrMap[clean]) return countryAbbrMap[clean];
        const words = name.trim().split(/\s+/);
        if (words.length === 1) return words[0];
        return words.map(w => w[0].toUpperCase()).join('');
    }

    function formatTime(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function get_player_id_in_element(element) {
        if (!element) return null;
        const match = element.parentElement?.href?.match(/.*XID=(?<target_id>\d+)/) ||
                      element.href?.match(/.*XID=(?<target_id>\d+)/);
        if (match) return match.groups.target_id;

        const anchors = element.getElementsByTagName('a');
        for (const anchor of anchors) {
            const m = anchor.href.match(/.*XID=(?<target_id>\d+)/);
            if (m) return m.groups.target_id;
        }

        let parent = element.parentElement;
        while (parent) {
            if (parent.nodeName.toLowerCase() === "a" && parent.href) {
                const m = parent.href.match(/.*XID=(?<target_id>\d+)/);
                if (m) return m.groups.target_id;
            }
            parent = parent.parentElement;
        }
        return null;
    }

    // --- Fast 1-Click Copy Utility ---
    function attachCopyButton(memberWrap, playerId, playerName) {
        if (!memberWrap || memberWrap.querySelector('.twse-copy-btn')) return;
        if (rD_getValue('copy_buttons_enabled', 'true') !== 'true') return;

        const btn = document.createElement('span');
        btn.className = 'twse-copy-btn';
        btn.title = `Copy "${playerName} [${playerId}]"`;
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const copyText = `${playerName} [${playerId}]`;
            navigator.clipboard.writeText(copyText).then(() => {
                showToast(`Copied: ${copyText}`);
            }).catch(() => {
                prompt("Copy target ID:", copyText);
            });
        });

        memberWrap.appendChild(btn);
    }

    // --- Torn API Status & Travel Fetching ---
    async function fetchFactionMembers(factionID) {
        if (!apiKey || !factionID) return null;
        try {
            // Try Torn API v2 first
            const urlV2 = `https://api.torn.com/v2/faction/${factionID}/members?striptags=true&key=${apiKey}`;
            const resV2 = await fetch(urlV2);
            if (resV2.ok) {
                const data = await resV2.json();
                if (data && Array.isArray(data.members)) return data;
            }
        } catch (e) {}

        try {
            // Robust fallback to Torn API v1
            const urlV1 = `https://api.torn.com/faction/${factionID}?selections=basic&key=${apiKey}&comment=FFScouterFaction`;
            const resV1 = await fetch(urlV1);
            if (resV1.ok) {
                const data = await resV1.json();
                if (data && data.members) {
                    const memberList = Object.entries(data.members).map(([id, m]) => ({
                        id: parseInt(id, 10) || id,
                        name: m.name || '',
                        level: m.level || 0,
                        status: m.status || { state: 'Okay', description: 'Okay' },
                        last_action: m.last_action || { status: 'Offline' }
                    }));
                    return { members: memberList };
                }
            }
        } catch (e) {}

        return null;
    }

    const countryNames = [
        { name: 'switzerland', abbr: 'Switz' },
        { name: 'cayman islands', abbr: 'Cayman' },
        { name: 'cayman', abbr: 'Cayman' },
        { name: 'south africa', abbr: 'Africa' },
        { name: 'united kingdom', abbr: 'UK' },
        { name: 'united arab emirates', abbr: 'UAE' },
        { name: 'argentina', abbr: 'Argentina' },
        { name: 'canada', abbr: 'Canada' },
        { name: 'china', abbr: 'China' },
        { name: 'hawaii', abbr: 'Hawaii' },
        { name: 'japan', abbr: 'Japan' },
        { name: 'mexico', abbr: 'Mexico' },
        { name: 'uae', abbr: 'UAE' },
        { name: 'uk', abbr: 'UK' }
    ];

    function parseTravelDestination(desc) {
        if (!desc || typeof desc !== 'string') return '';
        const clean = desc.trim();
        if (/to\s+torn/i.test(clean) || /returning/i.test(clean)) {
            return "TORN";
        }
        const lower = clean.toLowerCase();
        for (const item of countryNames) {
            if (lower.includes(item.name)) {
                return item.abbr;
            }
        }
        const toMatch = clean.match(/to\s+([A-Za-z\s]+)$/i);
        if (toMatch) {
            return abbreviateCountry(toMatch[1]);
        }
        return abbreviateCountry(clean);
    }

    function parseAbroadLocation(desc) {
        if (!desc || typeof desc !== 'string') return '';
        const lower = desc.toLowerCase();
        for (const item of countryNames) {
            if (lower.includes(item.name)) {
                return item.abbr;
            }
        }
        const loc = desc.replace(/^In\s+/i, '').trim();
        return abbreviateCountry(loc);
    }

    // Classification Categories:
    // 0: Unexpected Okay (Priority target!)
    // 1: Expected Okay
    // 2: In Hospital (Sorted ascending by time left)
    // 3: Incoming / Returning flight
    // 4: Abroad in country
    // 5: Outgoing flight
    // 6: Traveling
    // 7: In Jail / Fedded / Fallen / Other
    function classifyMember(member, liveDomStatusText) {
        const domTxt = (liveDomStatusText || '').trim();
        const domLower = domTxt.toLowerCase();

        // 1. If we have live API member data
        if (member && member.status) {
            const state = member.status.state || '';
            const desc = member.status.description || '';
            const until = parseInt(member.status.until || '0', 10);
            const nowSec = Math.floor(Date.now() / 1000);
            const delta = until > nowSec ? until - nowSec : 0;

            if (domLower.includes('okay') && state === 'Hospital' && delta > 0) {
                return { rank: 0, delta: 0, label: 'Unexpected Okay (Medded!)' };
            }

            if (state === 'Okay') {
                return { rank: 1, delta: 0, label: 'Okay' };
            }

            if (state === 'Hospital') {
                return { rank: 2, delta: delta, label: 'Hospital' };
            }

            if (state === 'Traveling') {
                if (/to\s+torn/i.test(desc) || /returning/i.test(desc)) {
                    return { rank: 3, delta: delta, label: 'Incoming' };
                }
                return { rank: 5, delta: delta, label: 'Outgoing' };
            }

            if (state === 'Abroad') {
                return { rank: 4, delta: delta, label: 'Abroad' };
            }

            return { rank: 7, delta: delta || 999999, label: state || 'Other' };
        }

        // 2. Fallback directly to live DOM status text (e.g. peaceful faction profile or API loading)
        if (domLower.includes('okay')) {
            return { rank: 1, delta: 0, label: 'Okay' };
        }

        // Check hospital timer in DOM (e.g., "48:40" or "1h 12m")
        const timeMatch = domTxt.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeMatch || domLower.includes('hospital') || domLower.includes('hosp')) {
            let sec = 999999;
            if (timeMatch) {
                if (timeMatch[3]) {
                    sec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3], 10);
                } else {
                    sec = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
                }
            } else {
                const hourMatch = domTxt.match(/(\d+)\s*h/i);
                const minMatch = domTxt.match(/(\d+)\s*m/i);
                if (hourMatch || minMatch) {
                    sec = (hourMatch ? parseInt(hourMatch[1], 10) * 3600 : 0) + (minMatch ? parseInt(minMatch[1], 10) * 60 : 0);
                }
            }
            return { rank: 2, delta: sec, label: 'Hospital' };
        }

        // Traveling / In flight
        if (domTxt.includes('✈') || domLower.includes('travel') || domLower.includes('flight')) {
            if (domLower.includes('torn') || domLower.includes('returning')) {
                return { rank: 3, delta: 5000, label: 'Incoming' };
            }
            return { rank: 5, delta: 10000, label: 'Outgoing' };
        }

        // In Jail / Fedded / Fallen / Inactive (lowest priority - cannot attack)
        if (domLower.includes('jail') || domLower.includes('federal') || domLower.includes('fallen')) {
            return { rank: 7, delta: 999999, label: 'Other' };
        }

        // Abroad / Foreign country badge
        if (domTxt.length > 0) {
            return { rank: 4, delta: 999999, label: 'Abroad' };
        }

        return { rank: 7, delta: 999999, label: 'Other' };
    }

    function getMemberOnlineTier(li, member) {
        if (member?.last_action?.status) {
            const s = String(member.last_action.status).toLowerCase();
            if (s === 'online') return 1;
            if (s === 'idle' || s === 'offline') return 2;
        }
        if (li) {
            const svgUse = li.querySelector('svg use');
            const href = svgUse ? (svgUse.getAttribute('href') || svgUse.getAttribute('xlink:href') || '') : '';
            if (href.includes('icon1') || href.toLowerCase().includes('online') || li.querySelector('[id*="icon1"], .online, [class*="online___"], [class*="userStatusOnline"], [class*="userOnlineStatusIcon"], [fill*="userStatusOnline"], [fill*="Online"]')) return 1;

            const iconWrap = li.querySelector('[title*="Online" i], [aria-label*="Online" i]');
            if (iconWrap) return 1;

            // React 19 SVG gradient/fill fallback
            const html = li.innerHTML;
            if (html.includes('userStatusOnline') || html.includes('svg-user-status-online') || html.includes('userOnlineStatusIcon')) return 1;
        }
        // Idle and Offline are treated as the same non-online tier
        return 2;
    }

    function updateMemberStatusDecoration(li, member) {
        if (!member || !member.status) return;

        const statusEl = li.querySelector('.status, .table-cell.status');
        if (!statusEl) return;

        const state = member.status.state;
        const desc = member.status.description || '';
        const until = parseInt(member.status.until || '0', 10);
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = until > nowSec ? until - nowSec : 0;
        const lastActionText = member.last_action?.relative || memberLastAction[member.id] || '';

        // Save countdown in cache
        if (remainingSec > 0) {
            memberCountdowns[member.id] = { until: until, state: state, desc: desc, lastAction: lastActionText };
        } else {
            delete memberCountdowns[member.id];
        }

        // Fast Copy button next to member name
        const memberContainer = li.querySelector('.honor-text-wrap, .member, a[href*="profiles.php?XID="]');
        if (memberContainer) {
            attachCopyButton(memberContainer, member.id, member.name || memberContainer.textContent.trim());
        }

        // Tooltip combining description and last action
        const fullTooltip = `${desc}${lastActionText ? ` • Last Action: ${lastActionText}` : ''}`;

        // Render Status Content:
        // 1. Okay -> Green text
        // 2. Hospital -> Clickable countdown timer badge linking to attack screen
        // 3. Traveling back to Torn -> Yellow badge "✈ TORN"
        // 4. Traveling to country -> Yellow badge "✈ [Country]"
        // 5. Overseas / Abroad -> Blue badge "[Country]" (NO airplane icon)
        if (state === 'Okay') {
            statusEl.innerHTML = `<span style="color: #4ade80; font-weight: 600;" title="${fullTooltip}">Okay</span>`;
        } else if (state === 'Hospital') {
            const timeStr = formatTime(remainingSec);
            const isNearExpiry = remainingSec > 0 && remainingSec <= 300; // <= 5 mins
            const nearClass = isNearExpiry ? 'near-expiry' : '';
            statusEl.innerHTML = `<a href="/page.php?sid=attack&user2ID=${member.id}" class="hosp-timer-badge ${nearClass}" title="${fullTooltip} • Click to open Attack screen">${timeStr}</a>`;
        } else if (state === 'Traveling') {
            const dest = parseTravelDestination(desc);
            const timeStr = remainingSec > 0 ? ` ${formatTime(remainingSec)}` : '';
            statusEl.innerHTML = `<span class="travel-status-badge traveling" title="${fullTooltip}">✈ ${dest}${timeStr}</span>`;
        } else if (state === 'Abroad') {
            const loc = parseAbroadLocation(desc);
            statusEl.innerHTML = `<span class="travel-status-badge abroad" title="${fullTooltip}">${loc}</span>`;
        }
    }

    function findAttackHospitalOverlay() {
        const attackRoot = document.getElementById('attack-root');
        if (!attackRoot) return null;
        const allElements = attackRoot.querySelectorAll('div, p, span');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const txt = (el.textContent || '').toUpperCase();
            if (txt.includes('CURRENTLY IN HOSPITAL') && txt.includes('CANNOT BE ATTACKED')) {
                if (el.children.length === 0 || (el.children.length === 1 && el.children[0].tagName === 'SPAN') || el.classList.contains('ff-attack-model-countdown')) {
                    return el.parentElement || el;
                }
                return el;
            }
        }
        return null;
    }

    function attachAttackTopBanner(target_id) {
        let banner = document.getElementById('ff-attack-hosp-banner');
        if (banner && banner.parentNode && document.body.contains(banner)) return banner;

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'ff-attack-hosp-banner';
            banner.className = 'ff-attack-hosp-banner';
            banner.style.display = 'none';
        }

        const attackRoot = document.getElementById('attack-root') || document.querySelector('.content-wrapper') || document.getElementById('mainContainer');
        if (!attackRoot) return banner;

        const topHeader = attackRoot.querySelector('h4, [class*="title___"], [class*="header___"], [class*="title"], [class*="top___"]');
        if (topHeader && topHeader.parentNode) {
            topHeader.parentNode.insertBefore(banner, topHeader.nextSibling);
        } else {
            attackRoot.prepend(banner);
        }
        return banner;
    }

    function updateAttackPageHospTimer(target_id) {
        if (!target_id) {
            const match = window.location.href.match(/user2ID=(\d+)/);
            if (match) target_id = match[1];
        }
        if (!target_id) return;

        const cached = memberCountdowns[target_id];
        if (!cached || cached.state !== 'Hospital') {
            const existingBanner = document.getElementById('ff-attack-hosp-banner');
            if (existingBanner && existingBanner.style.display !== 'none') existingBanner.style.display = 'none';
            const existingOverlayTimer = document.querySelector('.ff-attack-model-countdown');
            if (existingOverlayTimer) existingOverlayTimer.remove();
            return;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = (cached.until > nowSec) ? cached.until - nowSec : 0;
        const timeStr = formatTime(remainingSec);
        const stateKey = `${remainingSec}_${cached.state}`;

        // 1. Top Header Banner
        const topBanner = attachAttackTopBanner(target_id);
        if (topBanner && topBanner.dataset.lastStateKey !== stateKey) {
            topBanner.dataset.lastStateKey = stateKey;
            topBanner.style.display = 'inline-flex';
            if (remainingSec <= 0) {
                topBanner.className = 'ff-attack-hosp-banner discharged';
                topBanner.innerHTML = `<span class="ff-hosp-icon">⚡</span> <span class="ff-hosp-title">TARGET DISCHARGED!</span> <span class="ff-hosp-desc">Ready to attack</span>`;
            } else if (remainingSec <= 300) {
                topBanner.className = 'ff-attack-hosp-banner near-expiry';
                topBanner.innerHTML = `<span class="ff-hosp-icon">⚠️</span> <span class="ff-hosp-title">Discharging Soon:</span> <span class="ff-attack-hosp-timer">${timeStr}</span> <span class="ff-hosp-desc">(${cached.desc || 'In Hospital'})</span>`;
            } else {
                topBanner.className = 'ff-attack-hosp-banner';
                topBanner.innerHTML = `<span class="ff-hosp-icon">🏥</span> <span class="ff-hosp-title">In Hospital:</span> <span class="ff-attack-hosp-timer">${timeStr}</span> <span class="ff-hosp-desc">(${cached.desc || 'In Hospital'})</span>`;
            }
        }

        // 2. Character Model Overlay Box
        const overlay = findAttackHospitalOverlay();
        if (overlay) {
            let modelTimer = overlay.querySelector('.ff-attack-model-countdown');
            if (!modelTimer) {
                modelTimer = document.createElement('div');
                modelTimer.className = 'ff-attack-model-countdown';
                overlay.appendChild(modelTimer);
            }
            if (modelTimer.dataset.lastSec !== String(remainingSec)) {
                modelTimer.dataset.lastSec = String(remainingSec);
                if (remainingSec > 0) {
                    const isNear = remainingSec <= 300;
                    modelTimer.innerHTML = `
                        <div class="ff-countdown-digits ${isNear ? 'near-expiry' : ''}">⏱️ ${timeStr}</div>
                        <div class="ff-countdown-label">${isNear ? '⚡ DISCHARGING SOON' : 'HOSPITAL TIME REMAINING'}</div>
                    `;
                } else {
                    modelTimer.innerHTML = `
                        <div class="ff-countdown-digits near-expiry">⚡ 00:00</div>
                        <div class="ff-countdown-label">READY TO ATTACK!</div>
                    `;
                }
            }
        }
    }

    let attackStatusFetchInProgress = false;
    async function checkAndRenderAttackHospTimer(target_id) {
        if (!target_id || attackStatusFetchInProgress) return;
        
        const nowSec = Math.floor(Date.now() / 1000);
        let cached = memberCountdowns[target_id];
        const cachedLife = targetLifeData[target_id] || getCachedTargetLife(target_id);

        if ((!cached || !cached.until || cached.until < nowSec || !cachedLife) && apiKey) {
            attackStatusFetchInProgress = true;
            try {
                const url = `https://api.torn.com/user/${target_id}?selections=profile,basic&key=${apiKey}&comment=FFScouterAttack`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data) {
                        if (data.status) {
                            const until = parseInt(data.status.until || '0', 10);
                            const state = data.status.state || '';
                            const desc = data.status.description || '';
                            const lastAction = data.last_action?.relative || '';
                            memberCountdowns[target_id] = { until, state, desc, lastAction };
                        }
                        if (data.life && data.life.maximum) {
                            targetLifeData[target_id] = {
                                current: parseInt(data.life.current, 10) || 0,
                                maximum: parseInt(data.life.maximum, 10) || 0,
                                name: data.name || ''
                            };
                            try {
                                rD_setValue(`target_life_${target_id}`, JSON.stringify(targetLifeData[target_id]));
                            } catch (e) {}
                            updateAttackHpDisplay();
                        }
                    }
                }
            } catch (e) {
                console.error("Error fetching attack target status", e);
            } finally {
                attackStatusFetchInProgress = false;
            }
        }
        updateAttackPageHospTimer(target_id);
        updateAttackHpDisplay();
    }

    // --- Absolute HP Engine (Fight Screen) ---
    function getAttackTargetId() {
        const m = window.location.href.match(/user2ID=(\d+)/);
        return m ? m[1] : null;
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
        // 1. Check DOM barLife
        const barLife = document.getElementById('barLife') || document.querySelector('[class*="bar-life"]');
        if (barLife) {
            const text = barLife.textContent || '';
            const m = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
            if (m) {
                const max = parseInt(m[2].replace(/,/g, ''), 10);
                if (max > 0) {
                    if (currentUserId) rD_setValue(`my_max_hp_${currentUserId}`, String(max));
                    rD_setValue('my_max_hp', String(max));
                    return max;
                }
            }
        }
        // 2. Persistent storage
        const cached = rD_getValue(currentUserId ? `my_max_hp_${currentUserId}` : 'my_max_hp');
        if (cached) {
            const val = parseInt(cached, 10);
            if (val > 0) return val;
        }
        return 3937;
    }

    function getCachedTargetLife(targetId) {
        if (!targetId) return null;
        try {
            const stored = rD_getValue(`target_life_${targetId}`);
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return null;
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

        // Secondary verification via player names
        const myName = getMyPlayerName();
        const targetId = getAttackTargetId();
        const targetLife = targetId ? (targetLifeData[targetId] || getCachedTargetLife(targetId)) : null;
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

    function findLifeBarElement(cardEl) {
        if (!cardEl) return null;

        const isExcluded = (el) => !!el.closest('[class*="weapon___"], [class*="equip___"], [class*="item___"], [class*="cooldown___"], .ff-player-hp-badge, .ff-attack-hp-hud');

        const candidates = cardEl.querySelectorAll(
            '[class*="life___"], [class*="health___"], [class*="lifeBar___"], [class*="statusBar___"], [role="progressbar"]'
        );

        for (const el of candidates) {
            if (isExcluded(el)) continue;
            if (el.getAttribute('role') === 'progressbar') {
                return el;
            }
            if (el.querySelector('[class*="fill___"], [class*="filler___"], div[style*="width"], div[style*="transform"]')) {
                return el;
            }
            if (el.offsetWidth > 40 || (el.className && typeof el.className === 'string' && el.className.includes('life'))) {
                return el;
            }
        }

        const fills = cardEl.querySelectorAll('div[style*="width"], div[style*="transform"]');
        for (const fill of fills) {
            if (isExcluded(fill)) continue;
            const w = fill.style?.width || '';
            const t = fill.style?.transform || '';
            if (w.includes('%') || t.includes('scaleX')) {
                const parent = fill.parentElement;
                if (parent && !isExcluded(parent)) {
                    return parent;
                }
            }
        }

        return null;
    }

    function findPlayerNameElement(cardEl, isAttacker, knownName) {
        if (!cardEl) return null;

        const isExcluded = (el) => !!el.closest('[class*="weapon"], [class*="equip"], [class*="item"], [class*="cooldown"], [class*="action"], [class*="model"], [class*="loadout"], [class*="btn"], button');

        if (knownName && typeof knownName === 'string' && knownName.trim().length > 0) {
            const candidates = cardEl.querySelectorAll('span, div, p, h4, h3, a');
            for (const el of candidates) {
                if (isExcluded(el)) continue;
                const text = Array.from(el.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent)
                    .join('')
                    .trim();
                if (text === knownName || text.startsWith(knownName)) {
                    return el;
                }
            }
        }

        const headerCandidates = cardEl.querySelectorAll('[class*="userName___"], [class*="user___"], [class*="name___"], [class*="header___"], [class*="title___"]');
        for (const el of headerCandidates) {
            if (isExcluded(el)) continue;
            const text = (el.textContent || '').trim();
            if (/^(Primary|Secondary|Melee|Temporary|Weapon|Defend|Attack|Actions?)$/i.test(text)) continue;
            if (text.length > 0 && text.length < 35) {
                return el;
            }
        }

        return null;
    }

    function updateFighterNameHp(cardEl, hpInfo, isAttacker, knownName) {
        if (!cardEl || !hpInfo) return;

        const nameEl = findPlayerNameElement(cardEl, isAttacker, knownName);
        if (!nameEl) return;

        let hpSpan = nameEl.querySelector('.ff-player-hp-simple');
        if (!hpSpan) {
            if (nameEl.nextElementSibling?.classList.contains('ff-player-hp-simple')) {
                hpSpan = nameEl.nextElementSibling;
            } else {
                hpSpan = document.createElement('span');
                hpSpan.className = 'ff-player-hp-simple';
                if (nameEl.tagName === 'SPAN' || nameEl.tagName === 'A') {
                    nameEl.parentNode.insertBefore(hpSpan, nameEl.nextSibling);
                } else {
                    nameEl.appendChild(hpSpan);
                }
            }
        }

        let hpText = '';
        if (hpInfo.maximum > 0) {
            hpText = ` (${hpInfo.current.toLocaleString()} / ${hpInfo.maximum.toLocaleString()})`;
        } else if (hpInfo.percent != null) {
            hpText = ` (${Math.round(hpInfo.percent)}%)`;
        }

        if (hpSpan.dataset.lastText === hpText) return;
        hpSpan.dataset.lastText = hpText;
        hpSpan.textContent = hpText;

        if (hpInfo.percent <= 0) {
            hpSpan.style.color = '#94a3b8';
        } else if (hpInfo.percent <= 20) {
            hpSpan.style.color = '#ef4444';
        } else if (hpInfo.percent <= 50) {
            hpSpan.style.color = '#facc15';
        } else {
            hpSpan.style.color = '#4ade80';
        }
    }

    function updateAttackHpDisplay() {
        if (!window.location.href.includes("sid=attack")) return;

        // Cleanup any legacy badges, HUD, or in-bar text overlays
        const legacyBadges = document.querySelectorAll('.ff-player-hp-badge, .ff-life-bar-text');
        legacyBadges.forEach(b => b.remove());
        const legacyHud = document.getElementById('ff-attack-hp-hud');
        if (legacyHud) legacyHud.remove();

        const { attackerCard, defenderCard } = findFighterCards();
        if (!attackerCard && !defenderCard) return;

        // Reset any inline flex on headers if modified previously
        if (attackerCard) {
            const attHeader = attackerCard.querySelector('[class*="header___"], [class*="userName___"]');
            if (attHeader && attHeader.style.display === 'flex') attHeader.style.display = '';
        }
        if (defenderCard) {
            const defHeader = defenderCard.querySelector('[class*="header___"], [class*="userName___"]');
            if (defHeader && defHeader.style.display === 'flex') defHeader.style.display = '';
        }

        const targetId = getAttackTargetId();
        const cachedTargetLife = targetId ? (targetLifeData[targetId] || getCachedTargetLife(targetId)) : null;
        const defenderMaxHp = cachedTargetLife?.maximum || 0;
        const defenderName = cachedTargetLife?.name || (defenderCard?.querySelector('[class*="header___"], [class*="title___"], h4, .header, [class*="userName___"]')?.textContent?.trim() || null);

        const attackerMaxHp = getAttackerMaxHp();
        const attackerName = getMyPlayerName();

        if (attackerCard) {
            const attackerHp = getFighterHpInfo(attackerCard, attackerMaxHp, true);
            if (attackerHp) updateFighterNameHp(attackerCard, attackerHp, true, attackerName);
        }

        if (defenderCard) {
            const defenderHp = getFighterHpInfo(defenderCard, defenderMaxHp, false);
            if (defenderHp) updateFighterNameHp(defenderCard, defenderHp, false, defenderName);
        }
    }

    let attackHpObserver = null;
    function initAttackPageHpTracker() {
        if (!window.location.href.includes("sid=attack")) return;

        const targetId = getAttackTargetId();
        if (targetId) {
            checkAndRenderAttackHospTimer(targetId);
        }

        updateAttackHpDisplay();

        // 300ms periodic updater with dataset caching (0 DOM operations when unchanged)
        if (!window.__ffAttackHpInterval) {
            window.__ffAttackHpInterval = setInterval(updateAttackHpDisplay, 300);
        }
    }

    function updateAllHospitalTimers() {
        const nowSec = Math.floor(Date.now() / 1000);
        const liElements = document.querySelectorAll(".enemy-faction .members-list li, .your-faction .members-list li, .faction-info-wrap .members-list li");

        liElements.forEach(li => {
            const profileLink = li.querySelector('a[href*="profiles.php?XID="]');
            if (!profileLink) return;
            const match = profileLink.href.match(/XID=(\d+)/);
            if (!match) return;
            const userID = match[1];

            const cached = memberCountdowns[userID];
            if (!cached) return;

            const statusEl = li.querySelector('.status, .table-cell.status');
            if (!statusEl) return;

            const remainingSec = cached.until > nowSec ? cached.until - nowSec : 0;
            const fullTooltip = `${cached.desc}${cached.lastAction ? ` • Last Action: ${cached.lastAction}` : ''}`;

            let newHtml = '';
            if (cached.state === 'Hospital') {
                if (remainingSec <= 0) {
                    newHtml = `<a href="/page.php?sid=attack&user2ID=${userID}" class="hosp-timer-badge unexpected-okay" title="${fullTooltip} • Click to open Attack screen">00:00</a>`;
                } else {
                    const isNearExpiry = remainingSec <= 300;
                    const nearClass = isNearExpiry ? 'near-expiry' : '';
                    newHtml = `<a href="/page.php?sid=attack&user2ID=${userID}" class="hosp-timer-badge ${nearClass}" title="${fullTooltip} • Click to open Attack screen">${formatTime(remainingSec)}</a>`;
                }
            } else if (cached.state === 'Traveling') {
                const dest = parseTravelDestination(cached.desc);
                const timeStr = remainingSec > 0 ? ` ${formatTime(remainingSec)}` : '';
                newHtml = `<span class="travel-status-badge traveling" title="${fullTooltip}">✈ ${dest}${timeStr}</span>`;
            } else if (cached.state === 'Abroad') {
                const loc = parseAbroadLocation(cached.desc);
                newHtml = `<span class="travel-status-badge abroad" title="${fullTooltip}">${loc}</span>`;
            }

            if (newHtml && statusEl.dataset.lastHtml !== newHtml) {
                statusEl.dataset.lastHtml = newHtml;
                statusEl.innerHTML = newHtml;
            }
        });

        // Update attack screen hospital countdown & HP if on attack page
        if (window.location.href.includes("sid=attack")) {
            updateAttackPageHospTimer();
            updateAttackHpDisplay();
        }
    }

    async function refreshFactionStatusData() {
        if (apiCallInProgress || isListingPage()) return;
        const enemyFactionLink = document.querySelector(".opponentFactionName___vhESM, a[href*='step=profile&ID='][class*='opponent']");
        const yourFactionLink = document.querySelector(".currentFactionName___eq7n8, a[href*='step=profile&ID='][class*='current']");
        
        let enemyId = enemyFactionLink?.href?.match(/ID=(\d+)/)?.[1];
        let yourId = yourFactionLink?.href?.match(/ID=(\d+)/)?.[1];

        // Also check profile page faction (e.g. factions.php?step=profile&ID=1234 or factions.php?step=your)
        if (!enemyId && !yourId) {
            const pageIdMatch = window.location.href.match(/ID=(\d+)/);
            if (pageIdMatch) {
                enemyId = pageIdMatch[1];
            } else {
                // Check on-page faction links
                const anyFactionLink = document.querySelector("a[href*='step=profile&ID=']");
                const m = anyFactionLink?.href?.match(/ID=(\d+)/);
                if (m) enemyId = m[1];
            }
        }

        if (!enemyId && !yourId) return;

        apiCallInProgress = true;
        try {
            if (enemyId) {
                const data = await fetchFactionMembers(enemyId);
                if (data && Array.isArray(data.members)) {
                    data.members.forEach(m => { memberStatusMap[m.id] = m; });
                    const enemyIds = data.members.map(m => String(m.id));
                    if (enemyIds.length > 0) {
                        rD_setValue('cached_war_enemies', JSON.stringify(enemyIds));
                    }
                    const enemyContainers = document.querySelectorAll(".enemy-faction, [class*='enemyFaction'], [class*='opponentFaction'], .faction-info-wrap, .faction-members, .factions-members, .factions-wrap, .members-list, ul.table-body");
                    enemyContainers.forEach(enemyContainer => {
                        enemyContainer.querySelectorAll("li, [class*='tableRow'], [class*='table-row']").forEach(li => {
                            const pid = get_player_id_in_element(li);
                            if (pid && memberStatusMap[pid]) updateMemberStatusDecoration(li, memberStatusMap[pid]);
                        });
                    });
                }
            }
            if (yourId && yourId !== enemyId) {
                const data = await fetchFactionMembers(yourId);
                if (data && Array.isArray(data.members)) {
                    data.members.forEach(m => { memberStatusMap[m.id] = m; });
                    const yourContainers = document.querySelectorAll(".your-faction, [class*='yourFaction'], [class*='currentFaction']");
                    yourContainers.forEach(yourContainer => {
                        yourContainer.querySelectorAll("li, [class*='tableRow'], [class*='table-row']").forEach(li => {
                            const pid = get_player_id_in_element(li);
                            if (pid && memberStatusMap[pid]) updateMemberStatusDecoration(li, memberStatusMap[pid]);
                        });
                    });
                }
            }
            refreshActiveSorts();
        } catch (e) {
            console.error("Error refreshing faction status data", e);
        } finally {
            apiCallInProgress = false;
        }
    }

    // --- Unified Sorting Engine (Battle Stats & Smart War / Hosp) ---
    let isSortingList = false;

    function sortMembersList(listElement, mode) {
        if (!listElement || isSortingList) return;

        // If listElement is an outer container wrapping an inner table-body, redirect to the actual row container
        const innerBody = listElement.querySelector('ul.table-body, .table-body, [class*="tableBody"]');
        if (innerBody) listElement = innerBody;

        isSortingList = true;

        try {
            listElement.classList.add('ff-flex-sort');
            listElement.dataset.ffSortMode = mode;

            // Target player rows specifically, filtering out headers and extraneous divs
            let items = Array.from(listElement.querySelectorAll(':scope > li, :scope > div.table-row, :scope > [class*="tableRow"], :scope > [class*="table-row"]')).filter(el => {
                if (el.classList.contains('table-header') || el.classList.contains('members-list-header') || el.querySelector('.table-header')) return false;
                return !!(get_player_id_in_element(el) || el.querySelector('.member, [class*="member"], a[href*="profiles.php?XID="]'));
            });

            if (!items.length) {
                items = Array.from(listElement.children).filter(el => {
                    if (el.classList.contains('table-header') || el.classList.contains('members-list-header') || el.querySelector('.table-header')) return false;
                    return !!(get_player_id_in_element(el) || el.querySelector('.member, [class*="member"], a[href*="profiles.php?XID="]'));
                });
            }

            if (!items.length) return;

            // Record initial visual order for 100% faithful default reset
            items.forEach((item, idx) => {
                if (!item.hasAttribute('data-ff-original-index')) {
                    item.setAttribute('data-ff-original-index', String(idx));
                }
            });

            if (mode === 'default') {
                const sortedDefault = [...items].sort((a, b) => {
                    const aIdx = parseInt(a.getAttribute('data-ff-original-index') || '0', 10);
                    const bIdx = parseInt(b.getAttribute('data-ff-original-index') || '0', 10);
                    return aIdx - bIdx;
                });
                sortedDefault.forEach(li => {
                    li.style.order = '';
                    listElement.appendChild(li);
                });
                return;
            }

            const parsed = items.map((li, index) => {
                const playerId = get_player_id_in_element(li);
                
                // Battle Stats numeric value (4-step cascade)
                let bsNum = null;
                // 1. Cached Fair Fight estimate
                if (playerId) {
                    const resp = get_fair_fight_response(playerId);
                    if (resp) {
                        if (typeof resp.bs_estimate === 'number' && resp.bs_estimate > 0) bsNum = resp.bs_estimate;
                        else if (typeof resp.bs_estimate_human === 'string') bsNum = parseBsStringToNumber(resp.bs_estimate_human);
                    }
                }
                // 2. data-ff-bs-num attribute
                if (bsNum === null) {
                    const dataVal = li.getAttribute('data-ff-bs-num') || li.querySelector('[data-ff-bs-num]')?.getAttribute('data-ff-bs-num');
                    if (dataVal) {
                        const p = parseFloat(dataVal);
                        if (!isNaN(p) && p > 0) bsNum = p;
                    }
                }
                // 3. Dedicated Est. BS column or honor bar badge text
                if (bsNum === null) {
                    const badge = li.querySelector('.table-cell.ff-bs-col, .ff-bs-col, .ff-scouter-bs-badge, [class*="ff-bs-"]');
                    if (badge && badge.textContent) bsNum = parseBsStringToNumber(badge.textContent);
                }
                // 4. Fallback search inside row for badge text matching numbers with k/m/b/t units
                if (bsNum === null) {
                    const allBadges = li.querySelectorAll('[class*="badge"], [class*="indicator"], span, div');
                    for (let b = 0; b < allBadges.length; b++) {
                        const txt = allBadges[b].textContent?.trim() || '';
                        if (txt && /[\d.]+\s*[kmbt]/i.test(txt)) {
                            const p = parseBsStringToNumber(txt);
                            if (p !== null && p > 0) {
                                bsNum = p;
                                break;
                            }
                        }
                    }
                }

                // War Status / Hospitalization Classification & Online Tier
                const memberObj = playerId ? memberStatusMap[playerId] : null;
                const liveStatusTxt = li.querySelector('.status, .table-cell.status')?.textContent || '';
                const classification = classifyMember(memberObj, liveStatusTxt);
                const onlineTier = getMemberOnlineTier(li, memberObj);

                return {
                    li,
                    index,
                    playerId,
                    bsNum,
                    classRank: classification.rank,
                    delta: classification.delta,
                    onlineTier
                };
            });

            if (mode === 'war_hosp') {
                // Smart War Sorting:
                // Available targets (classRank <= 1, i.e., Okay / Unexpected Okay):
                // - Online targets first (onlineTier = 1), sorted by Battle Stats ascending
                // - Idle & Offline targets merged (onlineTier = 2), sorted by Battle Stats ascending
                // Followed by:
                // 2: In Hospital (Sorted ascending: least hospital time remaining first!)
                // 3: Incoming flight (landing soonest first)
                // 4: Abroad
                // 5: Outgoing flight
                // 6: Traveling
                // 7: Other
                parsed.sort((a, b) => {
                    const aIsOkay = a.classRank <= 1;
                    const bIsOkay = b.classRank <= 1;

                    if (aIsOkay && bIsOkay) {
                        // Both are available targets: sort onliners to top
                        if (a.onlineTier !== b.onlineTier) return a.onlineTier - b.onlineTier;
                        // Within same online tier, sort by Battle Stats ascending (lowest BS first)
                        if (a.bsNum !== null && b.bsNum !== null) return a.bsNum - b.bsNum;
                        if (a.bsNum !== null && b.bsNum === null) return -1;
                        if (a.bsNum === null && b.bsNum !== null) return 1;
                        return a.index - b.index;
                    }

                    if (aIsOkay && !bIsOkay) return -1;
                    if (!aIsOkay && bIsOkay) return 1;

                    // Non-available targets: sort by classRank (Hospital -> Incoming -> Abroad -> Outgoing)
                    if (a.classRank !== b.classRank) return a.classRank - b.classRank;

                    // For same classRank (e.g. Hospital or Incoming flight): least time remaining first
                    if (a.delta !== b.delta) return a.delta - b.delta;

                    // Then sort by Battle Stats ascending
                    if (a.bsNum !== null && b.bsNum !== null) return a.bsNum - b.bsNum;
                    if (a.bsNum !== null && b.bsNum === null) return -1;
                    if (a.bsNum === null && b.bsNum !== null) return 1;

                    return a.index - b.index;
                });
            } else if (mode === 'bs_asc') {
                // Lowest BS first (easiest targets on top)
                parsed.sort((a, b) => {
                    if (a.bsNum !== null && b.bsNum !== null) {
                        if (a.bsNum !== b.bsNum) return a.bsNum - b.bsNum;
                        return a.index - b.index;
                    }
                    if (a.bsNum !== null && b.bsNum === null) return -1;
                    if (a.bsNum === null && b.bsNum !== null) return 1;
                    return a.index - b.index;
                });
            } else if (mode === 'bs_desc') {
                // Highest BS first (titans on top)
                parsed.sort((a, b) => {
                    if (a.bsNum !== null && b.bsNum !== null) {
                        if (a.bsNum !== b.bsNum) return b.bsNum - a.bsNum;
                        return a.index - b.index;
                    }
                    if (a.bsNum !== null && b.bsNum === null) return -1;
                    if (a.bsNum === null && b.bsNum !== null) return 1;
                    return a.index - b.index;
                });
            }

            // Dual reordering: assign CSS flex order AND physically re-append ONLY if order changed
            let needsReorder = false;
            const currentChildren = Array.from(listElement.children);
            for (let i = 0; i < parsed.length; i++) {
                if (currentChildren[i] !== parsed[i].li) {
                    needsReorder = true;
                    break;
                }
            }

            if (needsReorder) {
                const fragment = document.createDocumentFragment();
                parsed.forEach((item, rank) => {
                    item.li.style.order = String(rank + 1);
                    fragment.appendChild(item.li);
                });
                listElement.appendChild(fragment);
            } else {
                parsed.forEach((item, rank) => {
                    item.li.style.order = String(rank + 1);
                });
            }
        } finally {
            isSortingList = false;
        }
    }

    function refreshActiveSorts() {
        if (isListingPage()) return;
        const activeLists = document.querySelectorAll('.ff-flex-sort[data-ff-sort-mode], [data-ff-sort-mode]');
        activeLists.forEach(list => {
            const mode = list.dataset.ffSortMode;
            if (mode && mode !== 'default') {
                sortMembersList(list, mode);
            }
        });
    }

    function setupWarSortBar(container, listElement) {
        if (!container || !listElement) return;

        // Ensure listElement is the true row container, not an outer wrapper
        const innerBody = listElement.querySelector('ul.table-body, .table-body, [class*="tableBody"]');
        if (innerBody) listElement = innerBody;

        let toolbar = container.querySelector('.ff-war-sort-toolbar');
        const tableHeader = container.querySelector('.table-header, [class*="tableHeader___"], [class*="tableHeader"], .members-list-header');

        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.className = 'ff-war-sort-toolbar';

            toolbar.innerHTML = `
                <span class="ff-sort-title">⚔️ War Sort:</span>
                <button type="button" class="ff-sort-btn ff-sort-war" data-mode="war_hosp" title="Smart War Sort: Okay -> Soonest out of Hospital -> Incoming -> Abroad -> Outgoing">⏱️ Hosp / War</button>
                <button type="button" class="ff-sort-btn ff-sort-asc" data-mode="bs_asc" title="Sort Lowest Battle Stats first (Easiest targets on top)">▲ Lowest BS</button>
                <button type="button" class="ff-sort-btn ff-sort-desc" data-mode="bs_desc" title="Sort Highest Battle Stats first (Titans on top)">▼ Highest BS</button>
                <button type="button" class="ff-sort-btn ff-sort-reset" data-mode="default" title="Reset to default Torn order">↺ Default</button>
            `;

            if (tableHeader && tableHeader.parentNode) {
                tableHeader.parentNode.insertBefore(toolbar, tableHeader);
            } else if (listElement.parentNode) {
                listElement.parentNode.insertBefore(toolbar, listElement);
            } else {
                container.prepend(toolbar);
            }

            const buttons = toolbar.querySelectorAll('.ff-sort-btn');

            function setActiveButton(mode) {
                buttons.forEach(btn => {
                    if (btn.dataset.mode === mode) btn.classList.add('active');
                    else btn.classList.remove('active');
                });
                listElement.dataset.ffSortMode = mode;
            }

            buttons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const mode = btn.dataset.mode;
                    setActiveButton(mode);
                    sortMembersList(listElement, mode);
                });
            });

            // Auto-sort by Hosp / War if enabled AND on a war page (don't force-sort peaceful profiles on load)
            const isWarPage = window.location.href.includes('war') || !!document.querySelector('.faction-war-view, .enemy-faction, [class*="enemyFaction"]');
            if (rD_getValue('auto_war_sort', 'true') === 'true' && isWarPage) {
                setActiveButton('war_hosp');
                sortMembersList(listElement, 'war_hosp');
            } else if (listElement.dataset.ffSortMode) {
                setActiveButton(listElement.dataset.ffSortMode);
            }
        } else {
            // Re-anchor toolbar before tableHeader if React moved or recreated tableHeader
            if (tableHeader && tableHeader.previousElementSibling !== toolbar && tableHeader.parentNode) {
                tableHeader.parentNode.insertBefore(toolbar, tableHeader);
            }
        }

        // Header click toggle
        const memberHeader = container.querySelector('.table-header .member, [class*="memberColumnHeader"], .table-header li:first-child, .members-list-header .member');
        if (memberHeader && !memberHeader.classList.contains('ff-sortable-header')) {
            memberHeader.classList.add('ff-sortable-header');
            memberHeader.style.cursor = 'pointer';
            memberHeader.title = 'Click to cycle sorting: Hosp / War ⏱️ -> Lowest BS ▲ -> Highest BS ▼ -> Default ↺';

            memberHeader.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const currentMode = listElement.dataset.ffSortMode || 'default';
                let nextMode = 'war_hosp';
                if (currentMode === 'default') nextMode = 'war_hosp';
                else if (currentMode === 'war_hosp') nextMode = 'bs_asc';
                else if (currentMode === 'bs_asc') nextMode = 'bs_desc';
                else if (currentMode === 'bs_desc') nextMode = 'default';

                const buttons = toolbar.querySelectorAll('.ff-sort-btn');
                buttons.forEach(btn => {
                    if (btn.dataset.mode === nextMode) btn.classList.add('active');
                    else btn.classList.remove('active');
                });
                listElement.dataset.ffSortMode = nextMode;
                sortMembersList(listElement, nextMode);
            });
        }
    }

    function ensureWarSortBars() {
        if (isListingPage()) return;
        const memberLists = document.querySelectorAll(
            '.members-list, ul.table-body, [class*="membersList___"], [class*="membersList"], [class*="tableBody"]'
        );
        memberLists.forEach(listElement => {
            // If this element contains an inner table-body, skip this outer wrapper so setupWarSortBar binds directly to the inner table-body
            if (listElement.querySelector('ul.table-body, .table-body, [class*="tableBody"]')) {
                return;
            }
            const container = listElement.closest('.enemy-faction, .your-faction, [class*="enemyFaction"], [class*="yourFaction"], [class*="opponentFaction"], [class*="currentFaction"], .faction-info-wrap, .faction-members, .factions-members, .faction-war-view, .faction-profile, [class*="factionProfile"], .factions-wrap, [class*="factionsWrap"]') || listElement.parentElement;
            if (container && listElement) {
                setupWarSortBar(container, listElement);
                if (container.matches && container.matches('.enemy-faction, [class*="enemyFaction"], [class*="opponentFaction"]')) {
                    const enemyIds = [];
                    listElement.querySelectorAll(':scope > li').forEach(li => {
                        const pid = get_player_id_in_element(li);
                        if (pid) enemyIds.push(pid);
                    });
                    if (enemyIds.length > 0) {
                        rD_setValue('cached_war_enemies', JSON.stringify(enemyIds));
                    }
                }
            }
        });
    }

    // --- Member List Dedicated Est. BS Column ---
    function updateFactionMemberTableBS() {
        // STRICT SCOPE: Execute on all Faction rosters (step=profile, step=your, #faction-info).
        // NEVER execute on Ranked War, War Views, or static directory listings (step=listing).
        if (!window.location.href.includes("factions.php") || isListingPage()) return;
        if (window.location.hash.includes('war') || window.location.href.includes('war') || document.querySelector('.faction-war-view, .war-view, [class*="factionWarView"], [class*="warView"], [class*="rankedWar"], [class*="enemyFaction"], [class*="opponentFaction"]')) return;

        // 1. Purge stray non-row estimate lines (Ironclad protection for all player rows)
        $(".table-body > li:not(.table-row), .table-body > div:not(.table-row), .table-body [class*='estimate']:not(.ff-scouter-bs-badge):not(.ff-bs-col), .members-list [class*='estimate']:not(.ff-scouter-bs-badge):not(.ff-bs-col)").each(function() {
            // NEVER remove any element that is or contains a player profile link or member cell!
            if ($(this).find('a[href*="profiles.php?XID="]').length > 0 || $(this).is('a[href*="profiles.php?XID="]') || $(this).hasClass('member') || $(this).hasClass('table-row') || $(this).hasClass('enemy-faction-member') || $(this).hasClass('your-faction-member')) {
                return;
            }
            const txt = $(this).text().toLowerCase();
            if (txt.includes('stats estimate') || txt.includes('estimate:')) $(this).remove();
        });

        // 2. Table Headers (Iterate ALL table headers across both enemy & friendly factions)
        $(".table-header, [class*='tableHeader'], .members-list-header").each(function() {
            const headerContainer = this;
            const headerLvl = $(headerContainer).find(".lvl, [class*='lvl']")[0];
            const headerIcons = $(headerContainer).find(".icons, [class*='icons']")[0];

            if (headerLvl) {
                let headerBS = $(headerContainer).find(".ff-bs-col")[0];
                if (!headerBS) {
                    headerBS = document.createElement('li');
                    headerBS.className = 'table-cell ff-bs-col';
                    headerBS.textContent = 'Est. BS';
                    headerLvl.after(headerBS);
                } else {
                    if (!headerBS.textContent.startsWith('Est. BS')) headerBS.textContent = 'Est. BS';
                    if (headerLvl.nextElementSibling !== headerBS) headerLvl.after(headerBS);
                }
                headerBS.style.fontWeight = '700';
                headerBS.style.textAlign = 'center';
                headerBS.style.cursor = 'pointer';
                headerBS.title = 'Click to sort by Battle Stats (Lowest ▲ / Highest ▼ / Default ↺)';

                // Remove non-bs sibling between lvl and icons
                let currH = headerLvl.nextElementSibling;
                while (currH && currH !== headerIcons && !currH.classList.contains('icons') && !currH.classList.contains('position')) {
                    if (currH !== headerBS && !currH.classList.contains('ff-bs-col')) {
                        const toRemove = currH;
                        currH = currH.nextElementSibling;
                        toRemove.remove();
                    } else {
                        currH = currH.nextElementSibling;
                    }
                }

                // Purge raw FF header text
                $(headerContainer).find(".ff, .table-cell.ff, li, div").each(function() {
                    if (!$(this).hasClass('ff-bs-col')) {
                        const txt = $(this).text().trim();
                        if (txt === 'FF' || $(this).hasClass('ff')) $(this).remove();
                    }
                });

                if (!headerBS.dataset.ffSortAttached) {
                    headerBS.dataset.ffSortAttached = 'true';
                    headerBS.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Find matching list/body for THIS specific header's container
                        const parentContainer = headerContainer.closest('.enemy-faction, .your-faction, [class*="enemyFaction"], [class*="yourFaction"], [class*="opponentFaction"], [class*="currentFaction"], .faction-info-wrap, .faction-members, .factions-members, .faction-war-view, .faction-profile, [class*="factionProfile"], .factions-wrap, [class*="factionsWrap"]') || headerContainer.parentElement;
                        let tableBody = parentContainer ? parentContainer.querySelector('.table-body, .members-list, [class*="tableBody"], [class*="membersList"]') : document.querySelector('.table-body, .members-list, [class*="tableBody"], [class*="membersList"]');
                        if (!tableBody) return;
                        const innerBody = tableBody.querySelector('ul.table-body, .table-body, [class*="tableBody"]');
                        if (innerBody) tableBody = innerBody;
                        const currentDir = tableBody.dataset.ffSortMode || 'default';
                        let nextDir = 'bs_asc';
                        if (currentDir === 'default') nextDir = 'bs_asc';
                        else if (currentDir === 'bs_asc') nextDir = 'bs_desc';
                        else if (currentDir === 'bs_desc') nextDir = 'default';

                        headerBS.textContent = nextDir === 'bs_asc' ? 'Est. BS ▲' : (nextDir === 'bs_desc' ? 'Est. BS ▼' : 'Est. BS');

                        // Sync toolbar button state
                        const toolbar = parentContainer ? parentContainer.querySelector('.ff-war-sort-toolbar') : document.querySelector('.ff-war-sort-toolbar');
                        if (toolbar) {
                            toolbar.querySelectorAll('.ff-sort-btn').forEach(btn => {
                                if (btn.dataset.mode === nextDir) btn.classList.add('active');
                                else btn.classList.remove('active');
                            });
                        }

                        sortMembersList(tableBody, nextDir);
                    });
                }
            }
        });

        // 3. Table Rows
        const rowElements = $(".table-body .table-row, .table-body > li, .members-list > li, [class*='tableBody'] .table-row, [class*='tableBody'] > li, [class*='membersList'] > li, [class*='tableRow']");
        rowElements.each(function () {
            const row = this;
            const lvlCell = $(row).find(".table-cell.lvl, .lvl, [class*='lvl']")[0];
            const iconsCell = $(row).find(".table-cell.icons, .icons, [class*='icons'], [class*='userIcons']")[0];
            if (!lvlCell) return;

            const memberCell = $(row).find(".member, [class*='member']")[0];
            const playerId = memberCell ? get_player_id_in_element(memberCell) : get_player_id_in_element(row);
            if (!playerId) return;

            let bsCell = $(row).find(".table-cell.ff-bs-col")[0];
            if (!bsCell) {
                bsCell = document.createElement('li');
                bsCell.className = 'table-cell ff-bs-col';
                lvlCell.after(bsCell);
            } else {
                if (lvlCell.nextElementSibling !== bsCell) lvlCell.after(bsCell);
            }

            // Remove rogue non-bs elements between lvl and icons
            let currR = lvlCell.nextElementSibling;
            while (currR && currR !== iconsCell && !currR.classList.contains('icons') && !currR.classList.contains('position')) {
                if (currR !== bsCell && !currR.classList.contains('ff-bs-col')) {
                    const toRemove = currR;
                    currR = currR.nextElementSibling;
                    toRemove.remove();
                } else {
                    currR = currR.nextElementSibling;
                }
            }

            // Purge rogue raw FF cells
            $(row).find(".table-cell.ff, .ff, [class*='fairfight'], [class*='fair-fight']").each(function() {
                if (!$(this).hasClass('ff-bs-col')) $(this).remove();
            });

            $(row).children().each(function() {
                if ($(this).hasClass('ff-bs-col') || $(this).hasClass('member') || $(this).hasClass('lvl') || $(this).hasClass('icons') || $(this).hasClass('score') || $(this).hasClass('attack')) return;
                const txt = $(this).text().trim();
                if (/^\d{1,4}\.\d{1,2}$/.test(txt)) $(this).remove();
            });

            const resp = get_fair_fight_response(playerId);
            if (resp) {
                const threat = get_target_threat_info(resp);
                const rawBs = resp.bs_estimate || resp.bs_estimate_human;
                const bsText = rawBs ? formatBattleStats(rawBs) : '-';
                const parsedBs = rawBs ? (typeof rawBs === 'number' ? rawBs : parseBsStringToNumber(rawBs)) : null;

                if (parsedBs) {
                    bsCell.setAttribute('data-ff-bs-num', String(parsedBs));
                    row.setAttribute('data-ff-bs-num', String(parsedBs));
                }

                if (bsCell.textContent !== bsText) bsCell.textContent = bsText;
                if (threat && threat.tier !== 'unrated') {
                    bsCell.style.backgroundColor = threat.badgeBg || threat.color;
                    bsCell.style.color = '#ffffff';
                    bsCell.style.fontWeight = '700';
                    bsCell.style.textAlign = 'center';
                    bsCell.style.fontSize = '12px';
                    bsCell.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
                    bsCell.title = threat.tooltip || '';
                } else {
                    bsCell.style.backgroundColor = 'rgba(60, 60, 60, 0.65)';
                    bsCell.style.color = '#cccccc';
                    bsCell.style.textAlign = 'center';
                }
            } else {
                if (bsCell.textContent !== '-') bsCell.textContent = '-';
                bsCell.style.backgroundColor = 'rgba(60, 60, 60, 0.65)';
                bsCell.style.color = '#cccccc';
                bsCell.style.textAlign = 'center';
            }
        });
    }

    // --- Threat Borders & Badges Decorator ---
    function show_cached_values(elements) {
        $('.ff-scouter-arrow, img[src*="arrow.svg"], .ff-scouter-bs-estimate').remove();

        for (const [player_id, element] of elements) {
            element.classList.add('ff-scouter-indicator');
            $(element).find('.ff-scouter-arrow, img[src*="arrow.svg"], .ff-scouter-bs-estimate').remove();

            const response = get_fair_fight_response(player_id);
            if (response) {
                const threat = get_target_threat_info(response);
                if (threat) {
                    const currentColor = element.style.getPropertyValue('--ff-border-color');
                    if (currentColor !== threat.color) {
                        element.style.setProperty('--ff-border-color', threat.color);
                        element.style.setProperty('--ff-border-glow', threat.glow);
                        element.style.setProperty('--ff-badge-bg', threat.badgeBg);
                        element.setAttribute('data-ff-threat', threat.tier);
                        element.setAttribute('title', threat.tooltip);
                    }

                    const rawBs = response.bs_estimate || response.bs_estimate_human;
                    const bsValue = rawBs ? formatBattleStats(rawBs) : (response.value ? `FF ${Math.round(response.value)}` : null);
                    const parsedBs = rawBs ? (typeof rawBs === 'number' ? rawBs : parseBsStringToNumber(rawBs)) : null;

                    if (bsValue) {
                        let badge = element.querySelector('.ff-scouter-bs-badge');
                        if (!badge) {
                            badge = document.createElement('div');
                            badge.className = 'ff-scouter-bs-badge';
                            element.appendChild(badge);
                        }
                        if (badge.textContent !== bsValue) badge.textContent = bsValue;
                        badge.style.backgroundColor = threat.badgeBg;
                        if (parsedBs) {
                            badge.setAttribute('data-ff-bs-num', String(parsedBs));
                            element.setAttribute('data-ff-bs-num', String(parsedBs));
                        }
                    } else {
                        const existingBadge = element.querySelector('.ff-scouter-bs-badge');
                        if (existingBadge) existingBadge.remove();
                    }
                }
            }
        }
        if (window.location.href.includes("factions.php") && !isListingPage()) {
            updateFactionMemberTableBS();
        }
    }

    async function apply_ff_gauge(elements) {
        elements = elements.filter(e => !e.hasAttribute('data-ff-threat') && !e.hasAttribute('data-ff-processed'));
        elements = elements.map(e => [get_player_id_in_element(e), e]).filter(e => e[0]);

        if (elements.length > 0) {
            elements.forEach(([pid, el]) => el.setAttribute('data-ff-processed', 'true'));
            show_cached_values(elements);
            const player_ids = elements.map(e => e[0]);
            update_ff_cache(player_ids, () => {
                show_cached_values(elements);
                refreshActiveSorts();
            });
        }
    }

    async function apply_to_mini_profile(mini) {
        const player_id = get_player_id_in_element(mini);
        if (player_id) {
            const response = get_fair_fight_response(player_id);
            if (response) {
                $(mini).find('.ff-scouter-mini-ff').remove();
                const difficulty = get_difficulty_text(response.value);
                const age = (Date.now() / 1000) - (response.last_updated || 0);
                let fresh = "";
                if (age >= 365 * 24 * 3600) fresh = `(${Math.round(age / (365 * 24 * 3600))}y old)`;
                else if (age >= 31 * 24 * 3600) fresh = `(${Math.round(age / (31 * 24 * 3600))}mo old)`;
                else if (age >= 24 * 3600) fresh = `(${Math.round(age / (24 * 3600))}d old)`;

                const bsEstimateStr = response.bs_estimate_human || (response.bs_estimate ? formatBattleStats(response.bs_estimate) : (response.value ? `~${Math.round(response.value)}` : null));
                const message = `Est. BS: [ ${bsEstimateStr || '-'} ] • ${difficulty} ${fresh}`;

                const description = $(mini).find('.description');
                const desc = $('<span></span>', { class: "ff-scouter-mini-ff" });
                desc.text(message);
                $(description).append(desc);
            }
        }
    }

    // --- Emergency Target Safety & Threat Filtering Engine ---
    function evaluateTargetSafety(playerId) {
        if (!playerId) return { isSafe: false, score: Infinity, threat: null, bs: null, ff: null, impossible: true };

        // STRICT NPC / RAID / LOOT BOSS BAN:
        // Duke [4] (5.5M HP), Leslie [15], etc. are massive multi-million HP loot bosses, NEVER easy 1-hit targets!
        const NPC_LOOT_BOSS_IDS = ['4', '15', '17', '19', '20', '21'];
        if (NPC_LOOT_BOSS_IDS.includes(String(playerId))) {
            return { isSafe: false, score: Infinity, threat: null, bs: null, ff: null, impossible: true, isLootBoss: true };
        }

        const resp = get_fair_fight_response(playerId);
        if (!resp || resp.no_data) {
            // Unrated / not yet evaluated in cache
            return { isSafe: false, score: 5000, threat: null, bs: null, ff: null, unrated: true };
        }

        const threat = get_target_threat_info(resp);
        const ff = typeof resp.value === 'number' ? resp.value : null;
        let bs = null;
        if (typeof resp.bs_estimate === 'number' && resp.bs_estimate > 0) {
            bs = resp.bs_estimate;
        } else if (typeof resp.bs_estimate_human === 'string') {
            bs = parseBsStringToNumber(resp.bs_estimate_human);
        }

        // STRICT REJECTION: Impossible or difficult targets MUST NEVER BE PICKED
        // 1. Threat tier 'cannot_win' (FF >= 4.2 or ratio >= 2.50x)
        if (threat && threat.tier === 'cannot_win') {
            return { isSafe: false, score: Infinity, threat, bs, ff, impossible: true };
        }
        // 2. Threat tier 'mod_difficult' (FF 3.2 - 4.2 or ratio 1.35x - 2.5x)
        if (threat && threat.tier === 'mod_difficult') {
            return { isSafe: false, score: Infinity, threat, bs, ff, impossible: true };
        }
        // 3. Direct Fair Fight check: FF >= 3.20 is dangerous / impossible
        if (ff !== null && ff >= 3.20) {
            return { isSafe: false, score: Infinity, threat, bs, ff, impossible: true };
        }
        // 4. Direct Battle Stats check vs player's stats: target > 1.35x player's stats is dangerous
        if (bs !== null && myTotalBattleStats && myTotalBattleStats > 0 && bs > (myTotalBattleStats * 1.35)) {
            return { isSafe: false, score: Infinity, threat, bs, ff, impossible: true };
        }

        // Target is confirmed SAFE & WINNABLE!
        // Rank order: very_easy (FF < 1.5) > easy (FF < 2.2) > moderate (FF < 3.2)
        let tierWeight = 300;
        if (threat) {
            if (threat.tier === 'very_easy') tierWeight = 10;
            else if (threat.tier === 'easy') tierWeight = 50;
            else if (threat.tier === 'moderate') tierWeight = 100;
        }
        const numericScore = tierWeight + (ff !== null ? ff : (bs ? bs / 1e7 : 10));

        return { isSafe: true, score: numericScore, threat, bs, ff };
    }

    // --- FF Scouter Innate Target Finder & Custom Target List ---
    function fetchFFScouterTargets(manual = false) {
        if (!apiKey) {
            if (manual) showToast("⚠️ API Key required to fetch FF Scouter targets.");
            return Promise.resolve([]);
        }

        const now = Date.now();
        const lastFetch = parseInt(rD_getValue('ff_targets_last_fetch', '0'), 10) || 0;
        const TWO_HOURS = 2 * 60 * 60 * 1000;

        if (!manual && now - lastFetch < TWO_HOURS) {
            try {
                const cached = JSON.parse(rD_getValue('ff_innate_targets', '[]'));
                if (Array.isArray(cached) && cached.length > 0) return Promise.resolve(cached);
            } catch (e) {}
        }

        if (manual) showToast("🔍 Querying FF Scouter Target Finder API...");

        return new Promise((resolve) => {
            const url = `${BASE_FF_URL}/api/v1/get-targets?key=${apiKey}&inactiveonly=1&minlevel=3&maxlevel=15&maxff=1.5&limit=30`;
            rD_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function (response) {
                    try {
                        if (response.status === 200) {
                            const data = JSON.parse(response.responseText);
                            if (Array.isArray(data) && data.length > 0) {
                                const targetList = data.map(item => ({
                                    id: String(item.player_id || item.id),
                                    name: item.name || '',
                                    ff: item.fair_fight || item.value || null,
                                    bs: item.bs_estimate || item.bs_estimate_human || null,
                                    level: item.level || null
                                })).filter(t => t.id && /^\d+$/.test(t.id));

                                rD_setValue('ff_innate_targets', JSON.stringify(targetList));
                                rD_setValue('ff_targets_last_fetch', String(Date.now()));
                                if (manual) showToast(`✅ Loaded ${targetList.length} safe targets from FF Scouter!`);
                                resolve(targetList);
                                return;
                            }
                        }
                    } catch (e) {
                        console.error("[FF Scouter] Error parsing get-targets response:", e);
                    }
                    if (manual) showToast("❌ Failed to fetch targets from FF Scouter.");
                    resolve([]);
                },
                onerror: function (err) {
                    console.error("[FF Scouter] Network error fetching get-targets:", err);
                    if (manual) showToast("❌ Network error fetching FF Scouter targets.");
                    resolve([]);
                }
            });
        });
    }

    function manageCustomTargetList() {
        let currentList = [];
        try {
            currentList = JSON.parse(rD_getValue('custom_target_list', '[]'));
        } catch (e) {}
        const currentStr = Array.isArray(currentList) ? currentList.join(', ') : '';

        const input = prompt(
            "📋 Custom Chain Target List Manager\n\n" +
            "Enter Target Player IDs separated by commas or spaces:\n" +
            "(e.g. 1776074, 1999595, 2061354, 849274 - inactive 1-hit targets)\n\n" +
            "The Hit button will cycle through these targets if no safe war enemies are available.\n" +
            "(Leave blank and click OK to clear the list):",
            currentStr
        );

        if (input !== null) {
            const ids = input
                .split(/[\s,]+/)
                .map(s => s.trim())
                .filter(s => /^\d+$/.test(s) && s !== '4' && s !== '15');
            
            const uniqueIds = [...new Set(ids)];
            if (uniqueIds.length > 0) {
                rD_setValue('custom_target_list', JSON.stringify(uniqueIds));
                showToast(`✅ Saved ${uniqueIds.length} custom chain targets!`);
            } else {
                rD_deleteValue('custom_target_list');
                showToast("Cleared custom chain target list.");
            }
        }
    }

    // Helper to find all enemy member elements in DOM across Torn War pages
    function getEnemyMemberElements() {
        const results = [];
        const seenPids = new Set();

        function processRow(el) {
            if (!el) return;
            const pid = get_player_id_in_element(el);
            if (!pid || seenPids.has(pid)) return;

            // Ironclad filter: NEVER include current user or own faction members
            if (currentUserId && String(pid) === String(currentUserId)) return;
            if (el.closest && el.closest('[class*="currentFaction"], [class*="yourFaction"], .your-faction')) return;

            seenPids.add(pid);
            results.push({ el, pid });
        }

        // 1. Locate Opponent / Enemy Faction containers strictly
        const enemyContainers = Array.from(document.querySelectorAll([
            '[class*="opponentFaction"]',
            '.enemy-faction',
            '[class*="enemyFaction"]',
            '.faction-war-view .enemy-faction',
            '.factions-war-view .enemy-faction',
            '.faction-info-wrap.enemy-faction'
        ].join(', '))).filter(c => {
            return !c.matches('[class*="currentFaction"], [class*="yourFaction"], .your-faction') &&
                   !c.closest('[class*="currentFaction"], [class*="yourFaction"], .your-faction');
        });

        if (enemyContainers.length > 0) {
            enemyContainers.forEach(container => {
                // A. Check profile links inside the enemy container
                const profileLinks = container.querySelectorAll('a[href*="profiles.php?XID="]');
                profileLinks.forEach(a => {
                    const row = (a.closest && a.closest('li, [class*="tableRow"], [class*="table-row"], div[class*="member___"]')) || a.parentElement;
                    processRow(row);
                });

                // B. Check list items / table rows inside the enemy container
                const rows = container.querySelectorAll('li, [class*="tableRow"], [class*="table-row"], [class*="membersList"] > li, ul.table-body > li');
                rows.forEach(r => processRow(r));
            });
        }

        // 2. Direct fallback across entire document if container wasn't identified
        if (results.length === 0) {
            const directEnemyRows = document.querySelectorAll([
                'li.enemy-faction-member',
                '[class*="enemyFactionMember"]',
                '[class*="opponentMember"]',
                'li[class*="opponent"]'
            ].join(', '));
            directEnemyRows.forEach(r => processRow(r));
        }

        return results;
    }

    // Curated Inactive 1-Hit Punching Bag Targets (Level <= 15, stats < 650, 100% inactive accounts)
    const CURATED_1HIT_TARGETS = [
        { id: "1776074", name: "DOMINODOM", level: 3, total: 164 },     // Inactive 5+ years, 164 stats
        { id: "1999595", name: "L3MILK", level: 4, total: 99 },          // Inactive 5+ years, 99 stats
        { id: "2061354", name: "Ghoad", level: 8, total: 172 },          // Inactive 4+ years, 172 stats
        { id: "1964175", name: "fijimarie", level: 8, total: 479 },      // Inactive 5+ years, 479 stats
        { id: "849274", name: "Deathreaper123", level: 14, total: 635 }, // Inactive 10+ years, 635 stats
        { id: "552906", name: "Footballman12", level: 15, total: 451 },  // Inactive 12+ years, 451 stats
        { id: "91892", name: "AbcDragonMaster", level: 15, total: 552 },  // Inactive 15+ years, 552 stats
        { id: "901426", name: "aaronyuan", level: 19, total: 54 },       // Inactive 10+ years, 54 stats (1-hit)
        { id: "1423394", name: "gogo234", level: 19, total: 67 },        // Inactive 8+ years, 67 stats (1-hit)
        { id: "1075217", name: "dmora", level: 19, total: 82 },          // Inactive 8+ years, 82 stats (1-hit)
        { id: "430622", name: "Braskius", level: 17, total: 113 },       // Inactive 11+ years, 113 stats (1-hit)
        { id: "969780", name: "livehere", level: 20, total: 80 }         // Inactive 10+ years, 80 stats (1-hit)
    ];

    function getNextCurated1HitTarget() {
        let idx = parseInt(rD_getValue('curated_1hit_idx', '0'), 10) || 0;
        const target = CURATED_1HIT_TARGETS[idx % CURATED_1HIT_TARGETS.length];
        rD_setValue('curated_1hit_idx', String((idx + 1) % CURATED_1HIT_TARGETS.length));
        return target;
    }

    function findEmergencyTargetId() {
        let customTarget = rD_getValue('emergency_hit_target', '');
        if (customTarget === '4' || customTarget === '15') {
            rD_deleteValue('emergency_hit_target');
            customTarget = '';
        }

        // 1. Scan active DOM if on a faction war page
        try {
            const enemyRows = getEnemyMemberElements();
            if (enemyRows.length > 0) {
                const candidates = [];
                for (const { el, pid } of enemyRows) {
                    if (!pid) continue;

                    // Live Status detection
                    let isOkay = false;
                    const apiMember = memberStatusMap[pid];
                    if (apiMember && apiMember.status && apiMember.status.state) {
                        isOkay = (apiMember.status.state === 'Okay');
                    } else {
                        const statusEl = el.querySelector ? el.querySelector('.status, [class*="status"], .table-cell.status') : null;
                        const statusTxt = (statusEl ? statusEl.textContent : el.textContent || '').toLowerCase();
                        const isHospital = statusTxt.includes('hospital') || statusTxt.includes('hosp') || /\b\d+[hm]\s*\d*s?\b/.test(statusTxt);
                        const isAway = statusTxt.includes('travel') || statusTxt.includes('abroad') || statusTxt.includes('jail') || statusTxt.includes('federal');
                        if (isHospital || isAway) {
                            isOkay = false;
                        } else if (statusTxt.includes('okay')) {
                            isOkay = true;
                        } else {
                            const atk = el.querySelector ? el.querySelector('a[href*="sid=attack"], a[href*="step=attack"], [class*="attack"]') : null;
                            if (atk && !atk.classList.contains('disabled')) {
                                isOkay = true;
                            } else {
                                isOkay = true;
                            }
                        }
                    }

                    // Level detection
                    let level = 999;
                    if (apiMember && apiMember.level) {
                        level = parseInt(apiMember.level, 10);
                    } else {
                        const lvlEl = el.querySelector ? el.querySelector('.lvl, [class*="lvl"], .level, [class*="level"], .table-cell.lvl') : null;
                        if (lvlEl) {
                            const m = lvlEl.textContent.match(/\d+/);
                            if (m) level = parseInt(m[0], 10);
                        }
                        if (level === 999) {
                            const textMatch = (el.textContent || '').match(/\b(?:lvl|level)\s*:?\s*(\d+)\b/i);
                            if (textMatch) level = parseInt(textMatch[1], 10);
                        }
                    }

                    // Threat & Safety evaluation
                    const evalResult = evaluateTargetSafety(pid);

                    // Cross-check DOM badge for unrated players
                    const badge = el.querySelector ? el.querySelector('.ff-scouter-bs-badge, .table-cell.ff-bs-col, [class*="estimate"]') : null;
                    if (badge && badge.textContent && !evalResult.impossible) {
                        const domBs = parseBsStringToNumber(badge.textContent);
                        if (domBs && domBs > 0) {
                            if (myTotalBattleStats && myTotalBattleStats > 0 && domBs > (myTotalBattleStats * 1.35)) {
                                evalResult.impossible = true;
                                evalResult.isSafe = false;
                            } else if (domBs > 500000000) {
                                evalResult.impossible = true;
                                evalResult.isSafe = false;
                            }
                        }
                    }

                    candidates.push({ pid, isOkay, level, evalResult });
                }

                // Cache all enemy IDs for other pages
                const allEnemyIds = candidates.map(c => c.pid);
                if (allEnemyIds.length > 0) {
                    rD_setValue('cached_war_enemies', JSON.stringify(allEnemyIds));
                }

                // 1A. Filter for Okay targets that are confirmed SAFE (NEVER impossible)
                const safeOkay = candidates.filter(c => c.isOkay && c.evalResult.isSafe && !c.evalResult.impossible);
                if (safeOkay.length > 0) {
                    safeOkay.sort((a, b) => a.evalResult.score - b.evalResult.score);
                    return safeOkay[0].pid;
                }

                // 1B. Filter for unrated Okay targets (EXCLUDING impossible ones, max level <= 35)
                const unratedOkay = candidates.filter(c => c.isOkay && !c.evalResult.impossible && c.level <= 35);
                if (unratedOkay.length > 0) {
                    // Sort by lowest level first (lower level = far less likely to be a titan)
                    unratedOkay.sort((a, b) => a.level - b.level);
                    return unratedOkay[0].pid;
                }
            }
        } catch (e) {
            console.error("[FF Scouter] Error scanning DOM for emergency targets:", e);
        }

        // 2. Scan in-memory memberStatusMap from API (if on other pages or cached in memory)
        try {
            const safeApiTargets = [];
            const unratedApiTargets = [];
            for (const [id, m] of Object.entries(memberStatusMap)) {
                if (m && m.status && m.status.state === 'Okay') {
                    const evalResult = evaluateTargetSafety(id);
                    if (!evalResult.impossible) {
                        const level = parseInt(m.level || '999', 10);
                        if (evalResult.isSafe) {
                            safeApiTargets.push({ id: String(id), evalResult });
                        } else if (level <= 35) {
                            unratedApiTargets.push({ id: String(id), level });
                        }
                    }
                }
            }
            if (safeApiTargets.length > 0) {
                safeApiTargets.sort((a, b) => a.evalResult.score - b.evalResult.score);
                return safeApiTargets[0].id;
            }
            if (unratedApiTargets.length > 0) {
                unratedApiTargets.sort((a, b) => a.level - b.level);
                return unratedApiTargets[0].id;
            }
        } catch (e) {}

        // 3. User-Compiled Custom Target List (Personal Target Roster)
        try {
            const customList = JSON.parse(rD_getValue('custom_target_list', '[]'));
            if (Array.isArray(customList) && customList.length > 0) {
                for (const cid of customList) {
                    const evalResult = evaluateTargetSafety(cid);
                    if (!evalResult.impossible) {
                        return String(cid);
                    }
                }
            }
        } catch (e) {}

        // 4. FF Scouter Innate Target Finder Cache (All verified safe, inactive, level <= 15, FF <= 1.5)
        try {
            const innateTargets = JSON.parse(rD_getValue('ff_innate_targets', '[]'));
            if (Array.isArray(innateTargets) && innateTargets.length > 0) {
                const safeInnate = innateTargets.filter(t => {
                    const evalResult = evaluateTargetSafety(t.id);
                    return !evalResult.impossible;
                });
                if (safeInnate.length > 0) {
                    safeInnate.sort((a, b) => (parseFloat(a.ff) || 2.0) - (parseFloat(b.ff) || 2.0));
                    return String(safeInnate[0].id);
                }
            }
        } catch (e) {}

        // 5. User-Configured Single Emergency Chain Target (Validated Safe)
        if (customTarget && /^\d+$/.test(customTarget.trim()) && customTarget.trim() !== '4' && customTarget.trim() !== '15') {
            const evalCustom = evaluateTargetSafety(customTarget.trim());
            if (!evalCustom.impossible) {
                return customTarget.trim();
            }
        }

        // 6. Cached War Enemies from previous visits (ONLY SAFE TARGETS!)
        try {
            const cached = JSON.parse(rD_getValue('cached_war_enemies', '[]'));
            if (Array.isArray(cached) && cached.length > 0) {
                const safeCached = [];
                for (const id of cached) {
                    const evalResult = evaluateTargetSafety(id);
                    if (evalResult.isSafe && !evalResult.impossible) {
                        safeCached.push({ id: String(id), evalResult });
                    }
                }
                if (safeCached.length > 0) {
                    safeCached.sort((a, b) => a.evalResult.score - b.evalResult.score);
                    return safeCached[0].id;
                }
            }
        } catch (e) {}

        // 7. Universal Fallback: Curated Inactive 1-Hit Punching Bag Targets (Level <= 15, stats < 650)
        const fallback1Hit = getNextCurated1HitTarget();
        if (fallback1Hit && fallback1Hit.id) {
            return fallback1Hit.id;
        }

        return null;
    }

    // --- Toast Notification ---
    function showToast(message) {
        const existing = document.getElementById('ffscouter-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'ffscouter-toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '30px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = '#1e293b';
        toast.style.border = '1px solid #38bdf8';
        toast.style.color = '#fff';
        toast.style.padding = '8px 16px';
        toast.style.borderRadius = '8px';
        toast.style.fontSize = '13.5px';
        toast.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)';
        toast.style.zIndex = '2147483647';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '10px';

        const closeBtn = document.createElement('span');
        closeBtn.textContent = '×';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.marginLeft = '8px';
        closeBtn.style.fontWeight = 'bold';
        closeBtn.style.fontSize = '18px';
        closeBtn.onclick = () => toast.remove();

        const msg = document.createElement('span');
        msg.textContent = message;

        toast.appendChild(msg);
        toast.appendChild(closeBtn);
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
    }

    // --- Directory Scanner for Faction Listing (step=listing & step=search) ---
    // Scopes strictly to visible leaders on the currently viewed page with zero lag
    function decorateLeaderHonorBar(element, response) {
        if (!element) return;
        element.classList.add('ff-scouter-indicator');

        if (response) {
            const threat = get_target_threat_info(response);
            if (threat && threat.tier !== 'unrated') {
                const currentColor = element.style.getPropertyValue('--ff-border-color');
                if (currentColor !== threat.color) {
                    element.style.setProperty('--ff-border-color', threat.color);
                    element.style.setProperty('--ff-border-glow', threat.glow);
                    element.style.setProperty('--ff-badge-bg', threat.badgeBg);
                    element.setAttribute('data-ff-threat', threat.tier);
                    element.setAttribute('title', threat.tooltip);
                }

                const rawBs = response.bs_estimate || response.bs_estimate_human;
                const bsValue = rawBs ? formatBattleStats(rawBs) : (response.value ? `FF ${Math.round(response.value)}` : null);
                const parsedBs = rawBs ? (typeof rawBs === 'number' ? rawBs : parseBsStringToNumber(rawBs)) : null;

                if (bsValue) {
                    let badge = element.querySelector('.ff-scouter-bs-badge');
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'ff-scouter-bs-badge';
                        element.appendChild(badge);
                    }
                    if (badge.textContent !== bsValue) badge.textContent = bsValue;
                    badge.style.backgroundColor = threat.badgeBg;
                    if (parsedBs) {
                        badge.setAttribute('data-ff-bs-num', String(parsedBs));
                        element.setAttribute('data-ff-bs-num', String(parsedBs));
                    }
                } else {
                    const existingBadge = element.querySelector('.ff-scouter-bs-badge');
                    if (existingBadge) existingBadge.remove();
                }
            } else {
                element.setAttribute('data-ff-threat', 'unrated');
            }
        } else {
            element.setAttribute('data-ff-threat', 'unrated');
        }
        element.setAttribute('data-ff-listing-processed', 'done');
    }

    let isListingProcessing = false;
    function processFactionListingPage() {
        if (!isListingPage() || isListingProcessing) return;
        isListingProcessing = true;

        try {
            // Target leader honor bars in the directory table rows
            const candidateBars = document.querySelectorAll(
                '.table-wrap .honor-text-wrap, .faction-list .honor-text-wrap, .factions-list .honor-text-wrap, [class*="factionList"] .honor-text-wrap, [class*="tableWrap"] .honor-text-wrap, .honor-text-wrap'
            );

            const missingPlayerIds = [];
            const elementsToFetch = [];

            for (const el of candidateBars) {
                if (el.getAttribute('data-ff-listing-processed') === 'done') continue;

                // Extract leader ID from element or row container
                const rowOrContainer = el.closest('li, tr, .table-row, [class*="tableRow"], [class*="faction"], .leader');
                const profileLink = el.querySelector('a[href*="profiles.php?XID="]') ||
                                    el.closest('a[href*="profiles.php?XID="]') ||
                                    rowOrContainer?.querySelector('a[href*="profiles.php?XID="]');

                const playerId = get_player_id_in_element(el) || profileLink?.href?.match(/XID=(\d+)/)?.[1];
                if (!playerId) continue;

                el.setAttribute('data-ff-listing-processed', 'pending');

                const cached = get_fair_fight_response(playerId);
                if (cached) {
                    decorateLeaderHonorBar(el, cached);
                } else {
                    missingPlayerIds.push(playerId);
                    elementsToFetch.push({ element: el, playerId });
                }
            }

            if (missingPlayerIds.length > 0) {
                const uniqueIds = [...new Set(missingPlayerIds)];
                update_ff_cache(uniqueIds, () => {
                    for (const item of elementsToFetch) {
                        if (!document.body.contains(item.element)) continue;
                        const resp = get_fair_fight_response(item.playerId);
                        decorateLeaderHonorBar(item.element, resp);
                    }
                });
            }

            // Also support mini-profiles if user clicks/hovers a leader
            const mini_profiles = document.querySelectorAll('[class^="profile-mini-_userProfileWrapper_"]:not(.ff-processed)');
            for (const mini of mini_profiles) {
                mini.classList.add('ff-processed');
                const player_id = get_player_id_in_element(mini);
                apply_to_mini_profile(mini);
                if (player_id) update_ff_cache([player_id], () => apply_to_mini_profile(mini));
            }
        } finally {
            isListingProcessing = false;
        }
    }

    let listingDebounceTimer = null;
    function queueFactionListingProcess(delay = 150) {
        if (listingDebounceTimer) clearTimeout(listingDebounceTimer);
        listingDebounceTimer = setTimeout(() => {
            processFactionListingPage();
        }, delay);
    }

    // Hashchange listener for pagination without full page reload
    window.addEventListener('hashchange', () => {
        if (isListingPage()) {
            queueFactionListingProcess(150);
        }
    });

    // --- Main Observer & Lifecycle ---
    create_text_location();
    fetchMyBattleStats();

    const match1 = window.location.href.match(/https:\/\/www\.torn\.com\/profiles\.php\?XID=(?<target_id>\d+)/);
    const match2 = window.location.href.match(/https:\/\/www\.torn\.com\/(?:loader|page)\.php\?sid=attack&user2ID=(?<target_id>\d+)/);
    const match = match1 || match2;
    if (match) {
        const target_id = match.groups.target_id;
        update_ff_cache([target_id], () => display_fair_fight(target_id));
        if (!apiKey) set_message("Limited API key needed - click to add");
        if (match2) {
            checkAndRenderAttackHospTimer(target_id);
            initAttackPageHpTracker();
        }
    }

    if (isListingPage()) {
        queueFactionListingProcess(300);
    }

    let isProcessingMutation = false;
    let mutationDebounceTimer = null;

    const mainObserver = new MutationObserver(function () {
        if (isProcessingMutation) return;

        if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
        mutationDebounceTimer = setTimeout(async () => {
            if (isProcessingMutation) return;
            isProcessingMutation = true;
            try {
                if (isListingPage()) {
                    queueFactionListingProcess(150);
                    return;
                }
                const honor_bars = $(".honor-text-wrap").toArray();
                if (honor_bars.length > 0) {
                    await apply_ff_gauge(honor_bars);
                } else {
                    if (window.location.href.includes("factions.php")) {
                        await apply_ff_gauge($(".member").toArray());
                    } else if (window.location.href.includes("companies.php") || window.location.href.includes("joblist.php")) {
                        await apply_ff_gauge($(".employee").toArray());
                    } else if (window.location.href.includes("messages.php") || window.location.href.includes("index.php") || window.location.href.includes("hospitalview.php") || window.location.href.includes("sid=UserList")) {
                        await apply_ff_gauge($(".name").toArray());
                    } else if (window.location.href.includes("bounties.php")) {
                        await apply_ff_gauge($(".target, .listed").toArray());
                    } else if (window.location.href.includes("forums.php")) {
                        await apply_ff_gauge($(".last-poster, .starter, .last-post, .poster").toArray());
                    } else if (window.location.href.includes("sid=competition")) {
                        await apply_ff_gauge($('[class*="name___"] .honor-text-wrap, [class*="name___"] a').toArray());
                    }
                }

                const mini_profiles = $('[class^="profile-mini-_userProfileWrapper_"]').toArray();
                for (const mini of mini_profiles) {
                    if (!mini.classList.contains('ff-processed')) {
                        mini.classList.add('ff-processed');
                        const player_id = get_player_id_in_element(mini);
                        apply_to_mini_profile(mini);
                        if (player_id) update_ff_cache([player_id], () => apply_to_mini_profile(mini));
                    }
                }

                if (window.location.href.includes("factions.php")) {
                    if (!document.querySelector('.ff-war-sort-toolbar')) {
                        ensureWarSortBars();
                    }
                }
            } finally {
                isProcessingMutation = false;
            }
        }, 200);
    });

    mainObserver.observe(document.body, { childList: true, subtree: true });

    // Periodic live countdown timers (1 second) - disabled on directory listing
    if (!isListingPage()) {
        setInterval(updateAllHospitalTimers, 1000);
    }

    // Periodic faction API refresh (15 seconds) & Continuous table / sort bar cleaner
    if (window.location.href.includes("factions.php") && !isListingPage()) {
        setInterval(refreshFactionStatusData, API_INTERVAL);
        setTimeout(refreshFactionStatusData, 1000); // Initial run after load
        setInterval(() => {
            updateFactionMemberTableBS();
            ensureWarSortBars();
        }, 1500);
    }

    // Background auto-check for updates (once every 24h, 3s after startup)
    setTimeout(autoCheckForUpdates, 3000);

    // Background pre-fetch of safe innate targets from FF Scouter Target Finder (1.5s after load)
    if (!isListingPage()) {
        setTimeout(() => { fetchFFScouterTargets(false); }, 1500);
    }

    console.log(`[FF Scouter + War Stuff Enhanced v${SCRIPT_VERSION}] Loaded Successfully.`);
})();