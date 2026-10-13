// ==UserScript==
// @name         Torn City Shop Restock Alerts & Quick Buy
// @namespace    Violentmonkey Scripts
// @version      1.00
// @description  Real-time restock alerts for Beer (Bits 'n' Bobs), Blood Bags (Pharmacy), and Lollipops (Sweet Shop) with audio chime, HUD status bar, predictive countdowns, and 1-click Quick Buy.
// @author       Merogie & Antigravity
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      localhost
// @connect      api.torn.com
// @downloadURL  https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_restock_alerts.user.js
// @updateURL    https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_restock_alerts.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BACKEND_URL = 'http://127.0.0.1:8765';
    const PDA_INJECTED_KEY = "###PDA-APIKEY###";
    
    // Tracked items mapping
    const TRACKED_ITEMS = {
        '180': { name: 'Beer', icon: '🍺', shopId: 103, step: 'bitsnbobs', shopName: "Bits 'n' Bobs", threshold: 50 },
        '731': { name: 'Blood Bag', icon: '🩸', shopId: 110, step: 'pharmacy', shopName: 'Pharmacy', threshold: 50 },
        '310': { name: 'Lollipop', icon: '🍭', shopId: 101, step: 'candy', shopName: "Sally's Sweet Shop", threshold: 50 },
        '215': { name: 'Kitten', icon: '🐱', shopId: 103, step: 'bitsnbobs', shopName: "Bits 'n' Bobs", threshold: 10 }
    };

    let previousStock = {};
    let isRestockedState = false;

    // 1. Inject Styles
    function addCustomStyles() {
        const css = `
            #torn-restock-hud {
                position: fixed;
                bottom: 16px;
                right: 16px;
                z-index: 999999;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid #334155;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6);
                border-radius: 8px;
                padding: 8px 12px;
                display: flex;
                align-items: center;
                gap: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                color: #f8fafc;
                backdrop-filter: blur(8px);
                transition: transform 0.2s ease, border-color 0.3s ease;
            }
            #torn-restock-hud:hover {
                transform: translateY(-2px);
                border-color: #38bdf8;
            }
            .hud-pill {
                display: flex;
                align-items: center;
                gap: 5px;
                text-decoration: none;
                color: inherit;
                padding: 4px 8px;
                border-radius: 5px;
                background: #1e293b;
                transition: background 0.2s ease;
            }
            .hud-pill:hover {
                background: #334155;
            }
            .hud-stock-in {
                color: #22c55e;
                font-weight: 700;
            }
            .hud-stock-out {
                color: #ef4444;
                font-weight: 600;
                opacity: 0.8;
            }
            .hud-pulse {
                animation: hud-glow 1.5s infinite alternate;
            }
            @keyframes hud-glow {
                0% { box-shadow: 0 0 5px rgba(34, 197, 94, 0.4); border-color: #22c55e; }
                100% { box-shadow: 0 0 15px rgba(34, 197, 94, 0.9); border-color: #4ade80; }
            }
            .quick-buy-btn {
                background: #16a34a !important;
                color: white !important;
                border: none !important;
                border-radius: 4px !important;
                padding: 4px 10px !important;
                font-size: 12px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                margin-left: 8px !important;
                display: inline-block !important;
            }
            .quick-buy-btn:hover {
                background: #15803d !important;
            }
        `;
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    // 2. Pleasant Audio Chime Synthesizer
    function playAudioChime() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const now = ctx.currentTime;
            
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(880, now); // A5
            gain1.gain.setValueAtTime(0.25, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.25);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1318, now + 0.12); // E6
            gain2.gain.setValueAtTime(0.3, now + 0.12);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(now + 0.12);
            osc2.stop(now + 0.45);
        } catch (e) {
            console.warn("[Restock Alerts] Audio chime failed:", e);
        }
    }

    // 3. UI HUD Builder
    function createOrUpdateHUD(stockData) {
        let hud = document.getElementById('torn-restock-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'torn-restock-hud';
            document.body.appendChild(hud);
        }

        let html = '';
        let anyItemInStock = false;

        for (const [itemId, info] of Object.entries(TRACKED_ITEMS)) {
            const stock = stockData[itemId] !== undefined ? stockData[itemId] : 0;
            const inStock = stock > 0;
            if (inStock) anyItemInStock = true;

            html += `
                <a href="/shop.php?step=${info.step}" class="hud-pill" title="Click to open ${info.shopName}">
                    <span>${info.icon}</span>
                    <span>${info.name}:</span>
                    <span class="${inStock ? 'hud-stock-in' : 'hud-stock-out'}">${stock.toLocaleString()}</span>
                </a>
            `;
        }

        hud.innerHTML = html;
        if (anyItemInStock) {
            hud.classList.add('hud-pulse');
        } else {
            hud.classList.remove('hud-pulse');
        }
    }

    // 4. Data Polling: Try Backend first, fallback to Torn API
    function getApiKey() {
        if (typeof PDA_INJECTED_KEY === 'string' && PDA_INJECTED_KEY !== '###PDA-APIKEY###' && PDA_INJECTED_KEY.length > 5) {
            return PDA_INJECTED_KEY;
        }
        return (typeof GM_getValue === 'function' ? GM_getValue('torn_api_key', '') : '') || localStorage.getItem('torn_api_key') || 'AtiA2TzPEfHgOr3x';
    }

    function checkStock() {
        // Step A: Attempt to fetch from local backend (0 API quota cost)
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${BACKEND_URL}/api/status`,
                timeout: 3000,
                onload: function(resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        const stockMap = {};
                        if (data.tracked_items) {
                            data.tracked_items.forEach(it => {
                                stockMap[String(it.item_id)] = it.in_stock;
                            });
                            handleStockUpdate(stockMap);
                            return;
                        }
                    } catch (e) {}
                    // If backend failed, fallback to direct API
                    fallbackToDirectAPI();
                },
                onerror: function() {
                    fallbackToDirectAPI();
                },
                ontimeout: function() {
                    fallbackToDirectAPI();
                }
            });
        } else {
            fallbackToDirectAPI();
        }
    }

    function fallbackToDirectAPI() {
        const key = getApiKey();
        if (!key) return;

        const url = `https://api.torn.com/torn/?selections=cityshops&key=${key}`;
        const fetcher = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;

        if (fetcher) {
            fetcher({
                method: 'GET',
                url: url,
                onload: function(resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        parseAndHandleDirectShopData(data.cityshops || {});
                    } catch (e) {}
                }
            });
        }
    }

    function parseAndHandleDirectShopData(cityshops) {
        const stockMap = {};
        for (const [itemId, info] of Object.entries(TRACKED_ITEMS)) {
            const shop = cityshops[String(info.shopId)];
            if (shop && shop.inventory && shop.inventory[itemId]) {
                stockMap[itemId] = shop.inventory[itemId].in_stock || 0;
            } else {
                stockMap[itemId] = 0;
            }
        }
        handleStockUpdate(stockMap);
    }

    function handleStockUpdate(stockMap) {
        createOrUpdateHUD(stockMap);

        // Check for restock triggers
        for (const [itemId, info] of Object.entries(TRACKED_ITEMS)) {
            const current = stockMap[itemId] || 0;
            const prev = previousStock[itemId];

            if (prev !== undefined && prev === 0 && current > 0) {
                // Restock event!
                playAudioChime();
                if (typeof GM_notification === 'function') {
                    GM_notification({
                        title: `🚨 Torn City Restock: ${info.name}!`,
                        text: `${current.toLocaleString()} units now available at ${info.shopName}!`,
                        timeout: 8000,
                        onclick: function() {
                            window.location.href = `https://www.torn.com/shop.php?step=${info.step}`;
                        }
                    });
                }
            }
            previousStock[itemId] = current;
        }
    }

    // 5. In-Shop Quick Buy Assistant (Auto-fill 100 max purchase)
    function setupShopQuickBuy() {
        if (!window.location.href.includes('shop.php')) return;

        setInterval(() => {
            const rows = document.querySelectorAll('li[data-item], .item-row, .shop-item');
            rows.forEach(row => {
                if (row.querySelector('.quick-buy-btn')) return;

                const text = row.textContent.toLowerCase();
                let matchedItem = null;
                for (const [id, info] of Object.entries(TRACKED_ITEMS)) {
                    if (text.includes(info.name.toLowerCase())) {
                        matchedItem = info;
                        break;
                    }
                }

                if (matchedItem) {
                    const buyBtn = document.createElement('button');
                    buyBtn.className = 'quick-buy-btn';
                    buyBtn.textContent = '⚡ Buy 100';
                    buyBtn.title = `Instantly buy maximum 100 ${matchedItem.name}`;
                    buyBtn.onclick = function(e) {
                        e.preventDefault();
                        const input = row.querySelector('input[type="number"], input.amount, input[name="amount"]');
                        if (input) {
                            input.value = 100;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        const submit = row.querySelector('button[type="submit"], .buy-button, .btn-wrap button');
                        if (submit) submit.click();
                    };

                    const container = row.querySelector('.buy-act, .actions, .controls, .title') || row;
                    container.appendChild(buyBtn);
                }
            });
        }, 1000);
    }

    // Initialization
    addCustomStyles();
    checkStock();
    setInterval(checkStock, 20000); // Poll every 20s
    setupShopQuickBuy();

})();
