// ==UserScript==
// @name         Torn Abroad Stock Restock Alert
// @namespace    https://github.com/MerogieMagic/Enhanced-FF-Scouter-Script
// @version      1.30
// @description  Zero-API real-time stock refill monitor for Torn abroad shops (Japan, South Africa, Switzerland, etc.). Hooks directly into Torn's native Centrifugo WebSocket ("travelShop" -> "itemsUpdated") and React DOM for sub-millisecond restock beep alerts with dedicated Xanax fanfare.
// @author       Merogie & Antigravity
// @match        https://www.torn.com/index.php*
// @match        https://www.torn.com/page.php?sid=travel*
// @match        https://torn.com/index.php*
// @match        https://torn.com/page.php?sid=travel*
// @run-at       document-end
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_abroad_stock_alert.user.js
// @updateURL    https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_abroad_stock_alert.user.js
// ==/UserScript==

(() => {
  'use strict';

  const pageWindow = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

  // Singleton guard against duplicate injection in Torn PDA / single page navigation
  if (pageWindow.__TORN_ABROAD_STOCK_ALERT_ACTIVE__) {
    if (typeof pageWindow.__TORN_ABROAD_STOCK_ALERT_RECHECK__ === 'function') {
      pageWindow.__TORN_ABROAD_STOCK_ALERT_RECHECK__();
    }
    return;
  }
  pageWindow.__TORN_ABROAD_STOCK_ALERT_ACTIVE__ = true;

  const SCRIPT_VERSION = '1.30';
  const SCRIPT_RAW_URL = 'https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_abroad_stock_alert.user.js';

  // ---------------- Storage & Polyfill Helpers ----------------
  function safeStorageGet(key, defVal) {
    try {
      if (typeof GM_getValue !== 'undefined') return GM_getValue(key, defVal);
      const v = localStorage.getItem('tasa_' + key);
      return v !== null ? v : defVal;
    } catch (e) {
      return defVal;
    }
  }

  function safeStorageSet(key, val) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, val);
        return;
      }
      localStorage.setItem('tasa_' + key, String(val));
    } catch (e) {}
  }

  function safeRequest(details) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      return GM_xmlhttpRequest(details);
    }
    return fetch(details.url, {
      method: details.method || 'GET',
      headers: details.headers || {},
      cache: 'no-cache'
    })
      .then(res => res.text().then(text => details.onload && details.onload({ status: res.status, responseText: text })))
      .catch(err => details.onerror && details.onerror(err));
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

  function showInfoToast(title, message, isSuccess = true) {
    try {
      const existing = document.querySelector('.torn-abroad-info-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'torn-abroad-info-toast';
      toast.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <span style="font-size:20px;">${isSuccess ? '✅' : 'ℹ️'}</span>
          <div style="flex:1;">
            <div style="font-weight:700; font-size:13px; color:${isSuccess ? '#4ade80' : '#38bdf8'};">${title}</div>
            <div style="font-size:12px; color:#e2e8f0; margin-top:2px;">${message}</div>
          </div>
          <button id="torn-abroad-info-close" type="button" style="background:transparent; border:none; color:#94a3b8; font-size:16px; cursor:pointer; padding:2px;">✕</button>
        </div>
      `;
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '9999999',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        border: `1px solid ${isSuccess ? 'rgba(74, 222, 128, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        borderRadius: '10px',
        padding: '12px 16px',
        minWidth: '280px',
        maxWidth: '90vw',
        fontFamily: 'Segoe UI, -apple-system, sans-serif',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      });
      document.body.appendChild(toast);
      const closeBtn = toast.querySelector('#torn-abroad-info-close');
      if (closeBtn) closeBtn.onclick = () => toast.remove();
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
    } catch (e) {
      console.log(`[Abroad Stock Alert] ${title}: ${message}`);
    }
  }

  function checkForScriptUpdates(manual = false) {
    if (manual) {
      showInfoToast('Checking GitHub for updates...', 'Connecting to repository...', false);
    }

    const cacheBuster = `?t=${Date.now()}`;
    safeRequest({
      method: 'GET',
      url: `${SCRIPT_RAW_URL}${cacheBuster}`,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      },
      onload: function (response) {
        try {
          if (response.status !== 200 || !response.responseText) {
            if (manual) showInfoToast('Update Check Failed', `GitHub responded with status ${response.status}`, false);
            return;
          }
          const versionMatch = response.responseText.match(/@version\s+([0-9.]+)/i);
          if (!versionMatch || !versionMatch[1]) {
            if (manual) showInfoToast('Update Check Failed', 'Could not parse version from GitHub repository.', false);
            return;
          }
          const remoteVersion = versionMatch[1].trim();
          safeStorageSet('last_update_check_time', String(Date.now()));

          if (isNewerVersion(remoteVersion, SCRIPT_VERSION)) {
            const confirmed = confirm(
              `🚀 A new version of Torn Abroad Stock Restock Alert is available!\n\n` +
              `Current Version: v${SCRIPT_VERSION}\n` +
              `Latest Version:  v${remoteVersion}\n\n` +
              `Click OK to open raw installer and update now.`
            );
            if (confirmed) {
              window.open(SCRIPT_RAW_URL, '_blank');
            }
          } else {
            if (manual) {
              showInfoToast('Latest Version Installed', `You are using the newest version (v${SCRIPT_VERSION})!`, true);
            }
          }
        } catch (e) {
          console.error('[Abroad Stock Alert] Update check error:', e);
          if (manual) showInfoToast('Update Check Error', e.message, false);
        }
      },
      onerror: function (err) {
        console.error('[Abroad Stock Alert] Network error during update check:', err);
        if (manual) showInfoToast('Update Check Error', 'Network error contacting GitHub.', false);
      }
    });
  }

  function autoCheckForUpdates() {
    const lastCheck = parseInt(safeStorageGet('last_update_check_time', '0'), 10) || 0;
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (now - lastCheck > TWENTY_FOUR_HOURS) {
      checkForScriptUpdates(false);
    }
  }

  // Register Menu Commands in Tampermonkey / Violentmonkey
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('📋 Configure Alert / Ignore Items', () => {
      openItemFilterModal();
    });
    GM_registerMenuCommand('🔄 Check for Stock Alert Updates', () => {
      checkForScriptUpdates(true);
    });
    GM_registerMenuCommand('🔊 Test Standard Double-Beep', () => {
      unlockAudioEngine();
      playRestockBeep('standard');
    });
    GM_registerMenuCommand('💊 Test Xanax Triumph Fanfare', () => {
      unlockAudioEngine();
      playRestockBeep('xanax');
    });
  }

  // ---------------- Known Abroad Item Master Map ----------------
  const KNOWN_ITEMS = {
    // Japan
    277: { name: 'Cherry Blossom Plushie', type: 'Plushie', country: 'Japan' },
    276: { name: 'Peony', type: 'Flower', country: 'Japan' },
    247: { name: 'Katana', type: 'Melee', country: 'Japan' },
    11:  { name: 'Nodachi', type: 'Melee', country: 'Japan' },
    246: { name: 'Fireworks', type: 'Temporary', country: 'Japan' },
    294: { name: 'Bottle of Saké', type: 'Alcohol', country: 'Japan' },
    239: { name: 'Ninja Stars', type: 'Temporary', country: 'Japan' },
    278: { name: 'Kabuki Mask', type: 'Clothing', country: 'Japan' },
    433: { name: 'Sensu', type: 'Other', country: 'Japan' },
    279: { name: 'Maneki Neko', type: 'Other', country: 'Japan' },
    429: { name: 'Chopsticks', type: 'Other', country: 'Japan' },
    434: { name: 'Yakitori Lantern', type: 'Other', country: 'Japan' },

    // South Africa (Xanax!)
    206: { name: 'Xanax', type: 'Drug', country: 'South Africa' },
    281: { name: 'Lion Plushie', type: 'Plushie', country: 'South Africa' },
    282: { name: 'African Violet', type: 'Flower', country: 'South Africa' },
    280: { name: 'Elephant Statue', type: 'Other', country: 'South Africa' },
    244: { name: 'Hunting Rifle', type: 'Primary', country: 'South Africa' },

    // Switzerland
    273: { name: 'Chamois Plushie', type: 'Plushie', country: 'Switzerland' },
    272: { name: 'Edelweiss', type: 'Flower', country: 'Switzerland' },
    224: { name: 'Swiss Army Knife', type: 'Melee', country: 'Switzerland' },

    // UAE
    384: { name: 'Camel Plushie', type: 'Plushie', country: 'UAE' },
    385: { name: 'Tribulus Omanense', type: 'Flower', country: 'UAE' },
    432: { name: 'Scimitar', type: 'Melee', country: 'UAE' },

    // China
    274: { name: 'Panda Plushie', type: 'Plushie', country: 'China' },
    275: { name: 'Jade Buddha', type: 'Other', country: 'China' },

    // United Kingdom
    268: { name: 'Red Fox Plushie', type: 'Plushie', country: 'United Kingdom' },
    266: { name: 'Nessie Plushie', type: 'Plushie', country: 'United Kingdom' },
    267: { name: 'Heather', type: 'Flower', country: 'United Kingdom' },

    // Argentina
    269: { name: 'Monkey Plushie', type: 'Plushie', country: 'Argentina' },
    271: { name: 'Ceibo Flower', type: 'Flower', country: 'Argentina' },
    180: { name: 'Bottle of Beer', type: 'Alcohol', country: 'Argentina' },

    // Hawaii
    264: { name: 'Orchid', type: 'Flower', country: 'Hawaii' },

    // Mexico
    258: { name: 'Jaguar Plushie', type: 'Plushie', country: 'Mexico' },
    260: { name: 'Dahlia', type: 'Flower', country: 'Mexico' },
    426: { name: 'Bottle of Tequila', type: 'Alcohol', country: 'Mexico' },

    // Cayman Islands
    618: { name: 'Stingray Plushie', type: 'Plushie', country: 'Cayman Islands' },
    617: { name: 'Banana Orchid', type: 'Flower', country: 'Cayman Islands' },

    // Canada
    261: { name: 'Wolverine Plushie', type: 'Plushie', country: 'Canada' },
    263: { name: 'Crocus', type: 'Flower', country: 'Canada' },
    262: { name: 'Hockey Stick', type: 'Other', country: 'Canada' },
  };

  // ---------------- Configuration & State ----------------
  const STORAGE_KEY = 'torn_abroad_alert_config';
  const DEFAULT_CONFIG = {
    audioEnabled: true,
    volume: 0.85,
    showHud: true,
    ignoredItems: {},
  };

  let config = Object.assign({}, DEFAULT_CONFIG);
  try {
    const saved = safeStorageGet(STORAGE_KEY, null) || localStorage.getItem(STORAGE_KEY);
    if (saved) config = Object.assign({}, DEFAULT_CONFIG, typeof saved === 'string' ? JSON.parse(saved) : saved);
    if (!config.ignoredItems || typeof config.ignoredItems !== 'object') {
      config.ignoredItems = {};
    }
  } catch (e) {
    config = Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig() {
    try {
      const json = JSON.stringify(config);
      localStorage.setItem(STORAGE_KEY, json);
      safeStorageSet(STORAGE_KEY, json);
    } catch (e) {
      console.warn('[Abroad Stock Alert] Failed to persist config:', e);
    }
  }

  function isItemIgnored(itemId, name = null) {
    if (!config.ignoredItems) return false;
    if (itemId !== null && itemId !== undefined) {
      if (config.ignoredItems[itemId] === true) return true;
      if (config.ignoredItems[String(itemId)] === true) return true;
    }
    const resolvedName = name || (itemId ? resolveItemName(itemId) : null);
    if (resolvedName) {
      if (config.ignoredItems[resolvedName.toLowerCase()] === true) return true;
    }
    return false;
  }

  function setItemIgnored(itemId, ignored, name = null) {
    if (!config.ignoredItems) config.ignoredItems = {};
    if (itemId !== null && itemId !== undefined) {
      if (ignored) {
        config.ignoredItems[itemId] = true;
      } else {
        delete config.ignoredItems[itemId];
        delete config.ignoredItems[String(itemId)];
      }
    }
    const resolvedName = name || (itemId ? resolveItemName(itemId) : null);
    if (resolvedName) {
      if (ignored) {
        config.ignoredItems[resolvedName.toLowerCase()] = true;
      } else {
        delete config.ignoredItems[resolvedName.toLowerCase()];
      }
    }
    saveConfig();
  }

  function applyHighValuePreset() {
    if (!config.ignoredItems) config.ignoredItems = {};
    Object.entries(KNOWN_ITEMS).forEach(([idStr, item]) => {
      const id = parseInt(idStr, 10);
      const isHighValue = /Plushie|Flower|Drug/i.test(item.type) || (id === 206) || /xanax/i.test(item.name);
      if (isHighValue) {
        delete config.ignoredItems[id];
        delete config.ignoredItems[String(id)];
        delete config.ignoredItems[item.name.toLowerCase()];
      } else {
        config.ignoredItems[id] = true;
        config.ignoredItems[item.name.toLowerCase()] = true;
      }
    });
    saveConfig();
  }

  function applyAlertAllPreset() {
    config.ignoredItems = {};
    saveConfig();
  }

  function applyIgnoreAllPreset() {
    if (!config.ignoredItems) config.ignoredItems = {};
    Object.entries(KNOWN_ITEMS).forEach(([idStr, item]) => {
      const id = parseInt(idStr, 10);
      config.ignoredItems[id] = true;
      config.ignoredItems[item.name.toLowerCase()] = true;
    });
    saveConfig();
  }

  // In-memory stock state: ID -> number
  const stockState = new Map();
  // Name mapping: ID -> string
  const idToNameMap = new Map();

  let wsHooked = false;
  let observer = null;
  let audioCtx = null;
  let audioUnlocked = false;
  let statusBadgeEl = null;

  // ---------------- Audio Synthesis Engine ----------------
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = pageWindow.AudioContext || pageWindow.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    return audioCtx;
  }

  function unlockAudioEngine() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        audioUnlocked = true;
      }).catch(() => {});
    } else if (ctx && ctx.state === 'running') {
      audioUnlocked = true;
    }
  }

  ['click', 'touchstart', 'touchend', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, () => unlockAudioEngine(), { passive: true, once: false });
  });

  // Dual-mode audio synthesis engine: 'standard' double-beep vs 'xanax' ascending power-up fanfare
  function playRestockBeep(soundType = 'standard') {
    if (!config.audioEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const vol = Math.min(Math.max(config.volume, 0.1), 1.0);

      // Master gain
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);

      if (soundType === 'xanax') {
        // 💊 XANAX EXCLUSIVE: 4-note ascending triumph fanfare (C5 -> E5 -> G5 -> C6 + C7 shimmer)
        masterGain.gain.setValueAtTime(vol * 0.65, now);

        const notes = [
          { freq: 523.25, start: 0.00, dur: 0.08, type: 'sine' },      // C5
          { freq: 659.25, start: 0.07, dur: 0.08, type: 'sine' },      // E5
          { freq: 783.99, start: 0.14, dur: 0.09, type: 'triangle' },  // G5
          { freq: 1046.50, start: 0.22, dur: 0.42, type: 'sine' },     // C6 (Climax)
          { freq: 2093.00, start: 0.22, dur: 0.35, type: 'triangle' }, // C7 (Golden harmonic shimmer)
        ];

        notes.forEach(({ freq, start, dur, type }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(freq, now + start);

          gain.gain.setValueAtTime(0, now + start);
          gain.gain.linearRampToValueAtTime(1, now + start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(now + start);
          osc.stop(now + start + dur + 0.03);
        });
      } else {
        // Standard item double-beep: Crisp A5 (880 Hz) -> Ascending E6 (1318.5 Hz)
        masterGain.gain.setValueAtTime(vol * 0.5, now);

        // Beep 1: High crisp A5 (880 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(1, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc1.connect(gain1);
        gain1.connect(masterGain);
        osc1.start(now);
        osc1.stop(now + 0.15);

        // Beep 2: Ascending E6 (1318.5 Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1318.5, now + 0.12);
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.setValueAtTime(1, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(masterGain);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.46);
      }

    } catch (err) {
      console.warn('[Abroad Stock Alert] Audio playback error:', err);
    }
  }

  // ---------------- Country Resolution ----------------
  function getActiveCountry() {
    // 1. Direct body attribute (verified in Torn layout: data-country="japan")
    const bodyCountry = document.body ? document.body.getAttribute('data-country') : null;
    if (bodyCountry) {
      return bodyCountry.charAt(0).toUpperCase() + bodyCountry.slice(1).toLowerCase();
    }

    // 2. Window topBannerInitData
    try {
      if (pageWindow.topBannerInitData && pageWindow.topBannerInitData.logo && pageWindow.topBannerInitData.logo.country) {
        const c = pageWindow.topBannerInitData.logo.country;
        return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
      }
    } catch (e) {}

    // 3. Text fallback
    const match = (document.body ? document.body.innerText : '').match(/You are in\s+([A-Za-z ]+?)\s+and have\b/i);
    if (match) return match[1].trim();

    return 'Abroad';
  }

  function isAbroad() {
    if (document.body) {
      if (document.body.getAttribute('data-abroad') === 'true') return true;
      if (document.body.getAttribute('data-country')) return true;
    }
    try {
      if (pageWindow.topBannerInitData && pageWindow.topBannerInitData.user && pageWindow.topBannerInitData.user.state) {
        return pageWindow.topBannerInitData.user.state.isAbroad === true;
      }
    } catch (e) {}
    return false;
  }

  // ---------------- Item Name Resolver ----------------
  function resolveItemName(itemId) {
    if (idToNameMap.has(itemId)) return idToNameMap.get(itemId);
    if (KNOWN_ITEMS[itemId]) return KNOWN_ITEMS[itemId].name;
    return `Item #${itemId}`;
  }

  // ---------------- Trigger Alert ----------------
  function handleRestock(itemId, newStock, prevStock, country) {
    const itemName = resolveItemName(itemId);
    const key = itemId !== null ? itemId : itemName;

    // Check if item is ignored per user filter list
    if (isItemIgnored(key, itemName)) {
      console.log(`[Abroad Stock Alert] Restock ignored for ${itemName} (ID: ${itemId}) per user filter.`);
      return;
    }

    const isXanax = (itemId === 206) || /xanax/i.test(itemName);
    const soundType = isXanax ? 'xanax' : 'standard';

    console.log(`%c[Abroad Stock Alert] 🚨 ${isXanax ? '💊 XANAX' : '📦 ITEM'} RESTOCK: ${itemName} (${prevStock} ➔ ${newStock}) in ${country}!`, 'background: #065f46; color: #34d399; font-weight: bold; padding: 4px;');

    playRestockBeep(soundType);
    showRestockToast(itemName, newStock, prevStock, country, isXanax);
    highlightItemInDom(itemId, itemName, isXanax);
  }

  // ---------------- Visual Notifications & Highlighting ----------------
  function showRestockToast(itemName, newStock, prevStock, country, isXanax = false) {
    const existing = document.getElementById('torn-abroad-restock-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'torn-abroad-restock-toast';
    const icon = isXanax ? '💊' : (/Plushie|Cherry/i.test(itemName) ? '🌸' : (/Flower/i.test(itemName) ? '🌺' : '📦'));

    const headerColor = isXanax ? '#facc15' : '#4ade80';
    const headerTitle = isXanax ? `💊 XANAX RESTOCKED! (${country})` : `⚡ Restock Detected (${country})`;
    const borderColor = isXanax ? '#eab308' : '#22c55e';
    const glowShadow = isXanax
      ? '0 10px 25px -5px rgba(234, 179, 8, 0.55), 0 8px 10px -6px rgba(0, 0, 0, 0.6)'
      : '0 10px 25px -5px rgba(34, 197, 94, 0.45), 0 8px 10px -6px rgba(0, 0, 0, 0.6)';

    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="font-size:28px;">${icon}</span>
        <div style="flex:1;">
          <div style="font-weight:900; font-size:13px; color:${headerColor}; text-transform:uppercase; letter-spacing:0.6px;">
            ${headerTitle}
          </div>
          <div style="font-size:14px; color:#f8fafc; margin-top:2px;">
            <strong style="color:#ffffff;">${itemName}</strong> is now in stock:
            <span style="color:${headerColor}; font-weight:900; font-size:16px;">${newStock.toLocaleString()}</span>
            ${prevStock === 0 ? '<span style="color:#94a3b8; font-size:11px; margin-left:4px;">(refilled from 0)</span>' : ''}
          </div>
        </div>
        <button id="torn-abroad-toast-close" type="button" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer; padding:4px;">✕</button>
      </div>
    `;

    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '9999999',
      background: isXanax
        ? 'linear-gradient(135deg, #1c1917 0%, #292524 100%)'
        : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      border: `2px solid ${borderColor}`,
      boxShadow: glowShadow,
      borderRadius: '12px',
      padding: '14px 18px',
      minWidth: '320px',
      maxWidth: '92vw',
      fontFamily: 'Segoe UI, -apple-system, sans-serif',
      animation: 'tornAbroadSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
    });

    document.body.appendChild(toast);

    toast.querySelector('#torn-abroad-toast-close').onclick = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 400);
    };

    // Auto dismiss after 14 seconds for Xanax, 10s for others
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 400);
      }
    }, isXanax ? 14000 : 10000);
  }

  function highlightItemInDom(itemId, itemName, isXanax = false) {
    // 1. Try finding row by item ID in image src
    let row = document.querySelector(`[class*="row___"] img[src*="/${itemId}/"]`);
    if (row) row = row.closest('[class*="row___"]');

    // 2. Try finding row by name button text
    if (!row && itemName) {
      const nameBtns = document.querySelectorAll('button[class*="itemNameButton"]');
      for (const btn of nameBtns) {
        if ((btn.textContent || '').trim().toLowerCase() === itemName.toLowerCase()) {
          row = btn.closest('[class*="row___"]');
          break;
        }
      }
    }

    if (!row) return;

    const origOutline = row.style.outline;
    const origBoxShadow = row.style.boxShadow;
    const origTransition = row.style.transition;

    const highlightBorder = isXanax ? '3px solid #eab308' : '2px solid #22c55e';
    const highlightGlow = isXanax ? '0 0 24px rgba(234, 179, 8, 0.85)' : '0 0 20px rgba(34, 197, 94, 0.7)';

    row.style.transition = 'all 0.3s ease';
    row.style.outline = highlightBorder;
    row.style.boxShadow = highlightGlow;

    setTimeout(() => {
      row.style.outline = origOutline;
      row.style.boxShadow = origBoxShadow;
      row.style.transition = origTransition;
    }, isXanax ? 15000 : 10000);
  }

  // ---------------- Interactive Item Alert Filter Modal ----------------
  let filterModalEl = null;

  function openItemFilterModal() {
    if (filterModalEl) {
      filterModalEl.remove();
      filterModalEl = null;
    }

    const currentCountry = getActiveCountry();
    let selectedCountry = currentCountry !== 'Abroad' ? currentCountry : 'All';
    let searchQuery = '';

    filterModalEl = document.createElement('div');
    filterModalEl.id = 'torn-abroad-filter-modal';
    Object.assign(filterModalEl.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(15, 23, 42, 0.78)',
      backdropFilter: 'blur(8px)',
      zIndex: '10000000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      boxSizing: 'border-box',
      fontFamily: 'Segoe UI, -apple-system, sans-serif',
      animation: 'tornAbroadSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
    });

    const modalDialog = document.createElement('div');
    Object.assign(modalDialog.style, {
      width: '100%',
      maxWidth: '560px',
      maxHeight: '85vh',
      backgroundColor: '#0f172a',
      border: '1px solid rgba(255, 255, 255, 0.18)',
      borderRadius: '16px',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      color: '#f8fafc',
    });

    function renderModalContent() {
      // Collect all items: KNOWN_ITEMS + any dynamically discovered items from DOM
      const allItemEntries = [];
      const seenIds = new Set();

      Object.entries(KNOWN_ITEMS).forEach(([idStr, item]) => {
        const id = parseInt(idStr, 10);
        seenIds.add(id);
        allItemEntries.push({
          id,
          name: item.name,
          type: item.type,
          country: item.country || 'Abroad',
        });
      });

      idToNameMap.forEach((name, id) => {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allItemEntries.push({
            id,
            name,
            type: /plushie/i.test(name) ? 'Plushie' : (/flower/i.test(name) ? 'Flower' : 'Other'),
            country: currentCountry,
          });
        }
      });

      // Filter by selectedCountry and searchQuery
      const filtered = allItemEntries.filter(item => {
        if (selectedCountry !== 'All' && item.country.toLowerCase() !== selectedCountry.toLowerCase()) {
          return false;
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q) || item.country.toLowerCase().includes(q);
        }
        return true;
      });

      const totalInView = filtered.length;
      const ignoredInView = filtered.filter(i => isItemIgnored(i.id, i.name)).length;
      const activeInView = totalInView - ignoredInView;

      modalDialog.innerHTML = `
        <!-- Modal Header -->
        <div style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:space-between; background:rgba(30, 41, 59, 0.6);">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:20px;">⚙️</span>
              <h3 style="margin:0; font-size:16px; font-weight:800; color:#38bdf8; letter-spacing:0.3px;">Restock Alert Filter</h3>
            </div>
            <div style="font-size:11.5px; color:#94a3b8; margin-top:3px;">
              Select items to alert (🔔) or ignore (🔕) on stock refills.
            </div>
          </div>
          <button id="torn-modal-close-btn" type="button" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; line-height:1; padding:4px;">✕</button>
        </div>

        <!-- Presets Bar -->
        <div style="padding: 10px 16px; background:#1e293b; border-bottom: 1px solid rgba(255,255,255,0.08); display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <span style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase;">Quick Presets:</span>
          <button id="torn-preset-highvalue" type="button" title="Alert only Plushies, Flowers, and Xanax" style="
            background: linear-gradient(135deg, #065f46 0%, #047857 100%);
            border: 1px solid #10b981;
            color: #ecfdf5;
            border-radius: 6px;
            padding: 4px 9px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
          ">
            🌸 Plushies + Flowers + Xanax
          </button>
          <button id="torn-preset-all" type="button" title="Enable alerts for all items" style="
            background: #334155;
            border: 1px solid #475569;
            color: #f8fafc;
            border-radius: 6px;
            padding: 4px 9px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
          ">
            🔔 Alert All
          </button>
          <button id="torn-preset-mute" type="button" title="Ignore all items" style="
            background: #334155;
            border: 1px solid #475569;
            color: #cbd5e1;
            border-radius: 6px;
            padding: 4px 9px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
          ">
            🔕 Mute All
          </button>
        </div>

        <!-- Search & Country Filters -->
        <div style="padding: 10px 16px; display:flex; gap:10px; align-items:center; background:#0f172a; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <input id="torn-filter-search" type="text" placeholder="🔍 Search items or categories..." value="${searchQuery}" style="
            flex: 1;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 6px 12px;
            font-size: 12px;
            color: #f8fafc;
            outline: none;
          " />
          <select id="torn-filter-country" style="
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 6px 10px;
            font-size: 12px;
            color: #38bdf8;
            font-weight: 600;
            outline: none;
            cursor: pointer;
          ">
            <option value="All" ${selectedCountry === 'All' ? 'selected' : ''}>🌍 All Abroad Shops</option>
            ${currentCountry !== 'Abroad' ? `<option value="${currentCountry}" ${selectedCountry.toLowerCase() === currentCountry.toLowerCase() ? 'selected' : ''}>📍 ${currentCountry} (Current)</option>` : ''}
            <option value="Japan" ${selectedCountry === 'Japan' ? 'selected' : ''}>🗾 Japan</option>
            <option value="South Africa" ${selectedCountry === 'South Africa' ? 'selected' : ''}>🇿🇦 South Africa</option>
            <option value="Switzerland" ${selectedCountry === 'Switzerland' ? 'selected' : ''}>🇨🇭 Switzerland</option>
            <option value="UAE" ${selectedCountry === 'UAE' ? 'selected' : ''}>🇦🇪 UAE</option>
            <option value="China" ${selectedCountry === 'China' ? 'selected' : ''}>🇨🇳 China</option>
            <option value="United Kingdom" ${selectedCountry === 'United Kingdom' ? 'selected' : ''}>🇬🇧 United Kingdom</option>
            <option value="Argentina" ${selectedCountry === 'Argentina' ? 'selected' : ''}>🇦🇷 Argentina</option>
            <option value="Hawaii" ${selectedCountry === 'Hawaii' ? 'selected' : ''}>🌺 Hawaii</option>
            <option value="Mexico" ${selectedCountry === 'Mexico' ? 'selected' : ''}>🇲🇽 Mexico</option>
            <option value="Cayman Islands" ${selectedCountry === 'Cayman Islands' ? 'selected' : ''}>🇰🇾 Cayman Islands</option>
            <option value="Canada" ${selectedCountry === 'Canada' ? 'selected' : ''}>🇨🇦 Canada</option>
          </select>
        </div>

        <!-- Scrollable Item List -->
        <div id="torn-filter-items-list" style="
          flex: 1;
          overflow-y: auto;
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-height: 220px;
          max-height: 52vh;
        ">
          ${filtered.length === 0 ? `
            <div style="text-align:center; padding:40px 20px; color:#64748b; font-size:13px;">
              No matching items found.
            </div>
          ` : filtered.map(item => {
            const isIgnored = isItemIgnored(item.id, item.name);
            const isXanax = item.id === 206 || /xanax/i.test(item.name);
            const typeColor = /Plushie/i.test(item.type) ? '#ec4899' : (/Flower/i.test(item.type) ? '#10b981' : (/Drug/i.test(item.type) ? '#eab308' : '#64748b'));

            return `
              <div class="torn-filter-item-row" data-id="${item.id}" data-name="${item.name}" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 12px;
                border-radius: 8px;
                background: ${isIgnored ? 'rgba(30, 41, 59, 0.4)' : (isXanax ? 'rgba(133, 77, 14, 0.15)' : 'rgba(30, 41, 59, 0.85)')};
                border: 1px solid ${isIgnored ? 'rgba(255, 255, 255, 0.05)' : (isXanax ? 'rgba(234, 179, 8, 0.4)' : 'rgba(34, 197, 94, 0.25)')};
                transition: all 0.15s ease;
              ">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                  <img src="https://www.torn.com/images/items/${item.id}/small.png" onerror="this.style.display='none'" style="width:26px; height:26px; object-fit:contain; flex-shrink:0;" />
                  <div style="flex:1; min-width:0; overflow:hidden;">
                    <div style="font-weight:700; font-size:13px; color:${isIgnored ? '#94a3b8' : (isXanax ? '#fef08a' : '#f8fafc')}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                      ${item.name}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                      <span style="font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; background:rgba(255,255,255,0.06); color:${typeColor};">
                        ${item.type}
                      </span>
                      <span style="font-size:10.5px; color:#64748b;">
                        ${item.country}
                      </span>
                    </div>
                  </div>
                </div>

                <button class="torn-filter-toggle-btn" data-id="${item.id}" type="button" style="
                  background: ${isIgnored ? '#334155' : (isXanax ? '#854d0e' : '#166534')};
                  border: 1px solid ${isIgnored ? '#475569' : (isXanax ? '#eab308' : '#22c55e')};
                  color: ${isIgnored ? '#94a3b8' : (isXanax ? '#fef08a' : '#dcfce7')};
                  border-radius: 14px;
                  padding: 4px 10px;
                  font-size: 11px;
                  font-weight: 700;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 4px;
                  flex-shrink: 0;
                  transition: all 0.15s ease;
                ">
                  ${isIgnored ? '🔕 Ignored' : '🔔 Alerting'}
                </button>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Footer -->
        <div style="padding: 12px 20px; background:rgba(15, 23, 42, 0.95); border-top: 1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:11.5px; color:#94a3b8;">
            <strong style="color:#4ade80;">${activeInView}</strong> Alerting • <span style="color:#f87171;">${ignoredInView}</span> Ignored
          </div>
          <button id="torn-modal-done-btn" type="button" style="
            background: #2563eb;
            border: 1px solid #3b82f6;
            color: #ffffff;
            border-radius: 8px;
            padding: 6px 16px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
          ">
            Done
          </button>
        </div>
      `;

      // Wire close buttons
      const closeBtn = modalDialog.querySelector('#torn-modal-close-btn');
      if (closeBtn) closeBtn.onclick = () => closeModal();
      const doneBtn = modalDialog.querySelector('#torn-modal-done-btn');
      if (doneBtn) doneBtn.onclick = () => closeModal();

      // Wire search input
      const searchInput = modalDialog.querySelector('#torn-filter-search');
      if (searchInput) {
        searchInput.oninput = (e) => {
          searchQuery = e.target.value;
          renderModalContent();
          const nextInput = modalDialog.querySelector('#torn-filter-search');
          if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(searchQuery.length, searchQuery.length);
          }
        };
      }

      // Wire country dropdown
      const countrySelect = modalDialog.querySelector('#torn-filter-country');
      if (countrySelect) {
        countrySelect.onchange = (e) => {
          selectedCountry = e.target.value;
          renderModalContent();
        };
      }

      // Wire preset buttons
      const highValueBtn = modalDialog.querySelector('#torn-preset-highvalue');
      if (highValueBtn) {
        highValueBtn.onclick = () => {
          applyHighValuePreset();
          renderModalContent();
          scanDomShopItems();
          showInfoToast('🌟 Preset Applied', 'Alerting on Plushies, Flowers, and Xanax only.', true);
        };
      }

      const allBtn = modalDialog.querySelector('#torn-preset-all');
      if (allBtn) {
        allBtn.onclick = () => {
          applyAlertAllPreset();
          renderModalContent();
          scanDomShopItems();
          showInfoToast('🔔 All Items Active', 'All abroad restocks will now trigger alerts.', true);
        };
      }

      const muteBtn = modalDialog.querySelector('#torn-preset-mute');
      if (muteBtn) {
        muteBtn.onclick = () => {
          applyIgnoreAllPreset();
          renderModalContent();
          scanDomShopItems();
          showInfoToast('🔕 All Items Muted', 'All items ignored. Click individual items to re-enable.', false);
        };
      }

      // Wire item toggle buttons
      modalDialog.querySelectorAll('.torn-filter-toggle-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const itemId = parseInt(btn.getAttribute('data-id'), 10);
          const currentIgnored = isItemIgnored(itemId);
          setItemIgnored(itemId, !currentIgnored);
          renderModalContent();
          scanDomShopItems();
        };
      });
    }

    function closeModal() {
      if (filterModalEl) {
        filterModalEl.style.opacity = '0';
        filterModalEl.style.transform = 'scale(0.96)';
        filterModalEl.style.transition = 'all 0.2s ease';
        setTimeout(() => {
          if (filterModalEl) {
            filterModalEl.remove();
            filterModalEl = null;
          }
        }, 200);
      }
    }

    filterModalEl.onclick = (e) => {
      if (e.target === filterModalEl) closeModal();
    };

    renderModalContent();
    filterModalEl.appendChild(modalDialog);
    document.body.appendChild(filterModalEl);
  }

  // ---------------- Status Badge / Floating HUD ----------------
  function renderStatusBadge(country, trackedCount) {
    if (!config.showHud) {
      if (statusBadgeEl) statusBadgeEl.remove();
      return;
    }

    if (!statusBadgeEl) {
      statusBadgeEl = document.createElement('div');
      statusBadgeEl.id = 'torn-abroad-stock-hud';
      Object.assign(statusBadgeEl.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: '999998',
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: '24px',
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        fontFamily: 'Segoe UI, -apple-system, sans-serif',
        fontSize: '12px',
        color: '#e2e8f0',
        cursor: 'default',
        userSelect: 'none',
      });
      document.body.appendChild(statusBadgeEl);
    }

    const flagMap = {
      Japan: '🗾',
      'South Africa': '🇿🇦',
      Switzerland: '🇨🇭',
      UAE: '🇦🇪',
      China: '🇨🇳',
      'United Kingdom': '🇬🇧',
      Argentina: '🇦🇷',
      Hawaii: '🌺',
      Canada: '🇨🇦',
      'Cayman Islands': '🇰🇾',
      Mexico: '🇲🇽',
    };
    const flag = flagMap[country] || '✈️';

    statusBadgeEl.innerHTML = `
      <span style="font-size:15px;">${flag}</span>
      <span style="font-weight:700; color:#38bdf8;">${country}</span>
      <span style="color:#64748b;">•</span>
      <span style="color:#4ade80; display:inline-flex; align-items:center; gap:5px;">
        <span style="width:7px; height:7px; border-radius:50%; background:#22c55e; display:inline-block; animation:tornPulseDot 1.5s infinite;"></span>
        Socket Active (${trackedCount})
      </span>
      <button id="torn-abroad-open-filter" type="button" title="Configure Alert/Ignore Item List" style="
        background: #0284c7;
        border: 1px solid #38bdf8;
        color: #f0f9ff;
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 3px;
        margin-left: 4px;
      ">
        📋 Filter
      </button>
      <button id="torn-abroad-test-beep" type="button" title="Test Regular Alert Sound" style="
        background: #334155;
        border: 1px solid #475569;
        color: #f8fafc;
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 3px;
      ">
        🔊 Test
      </button>
      <button id="torn-abroad-test-xanax" type="button" title="Test Xanax Power-Up Fanfare" style="
        background: #854d0e;
        border: 1px solid #eab308;
        color: #fef08a;
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 3px;
      ">
        💊 Xanax
      </button>
      <button id="torn-abroad-check-update" type="button" title="Check for Script Updates" style="
        background: #1e293b;
        border: 1px solid #475569;
        color: #94a3b8;
        border-radius: 12px;
        padding: 2px 7px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 3px;
        margin-left: 2px;
      ">
        🔄 v${SCRIPT_VERSION}
      </button>
    `;

    const filterBtn = statusBadgeEl.querySelector('#torn-abroad-open-filter');
    if (filterBtn) {
      filterBtn.onclick = (e) => {
        e.stopPropagation();
        openItemFilterModal();
      };
    }

    const testBtn = statusBadgeEl.querySelector('#torn-abroad-test-beep');
    if (testBtn) {
      testBtn.onclick = (e) => {
        e.stopPropagation();
        unlockAudioEngine();
        playRestockBeep('standard');
      };
    }

    const testXanaxBtn = statusBadgeEl.querySelector('#torn-abroad-test-xanax');
    if (testXanaxBtn) {
      testXanaxBtn.onclick = (e) => {
        e.stopPropagation();
        unlockAudioEngine();
        playRestockBeep('xanax');
      };
    }

    const updateBtn = statusBadgeEl.querySelector('#torn-abroad-check-update');
    if (updateBtn) {
      updateBtn.onclick = (e) => {
        e.stopPropagation();
        checkForScriptUpdates(true);
      };
    }
  }

  // Inject CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes tornPulseDot {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.35); opacity: 1; filter: drop-shadow(0 0 4px #22c55e); }
      100% { transform: scale(0.95); opacity: 0.8; }
    }
    @keyframes tornAbroadSlideIn {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ---------------- TIER 1: Native WebSocket Hook ----------------
  function onItemsUpdated(items) {
    if (!Array.isArray(items)) return;
    const country = getActiveCountry();

    items.forEach((item) => {
      if (!item || typeof item.id !== 'number' || typeof item.stock !== 'number') return;
      const { id, stock } = item;
      const hasPrev = stockState.has(id);
      const prevStock = hasPrev ? stockState.get(id) : null;

      // Update in-memory state
      stockState.set(id, stock);

      // Check for restock transition
      if (hasPrev && stock > prevStock) {
        handleRestock(id, stock, prevStock, country);
      }
    });

    renderStatusBadge(country, stockState.size);
  }

  function tryHookWebsocketHandler() {
    if (wsHooked) return true;
    const wsh = pageWindow.WebsocketHandler;
    if (wsh && typeof wsh.addEventListener === 'function') {
      try {
        wsh.addEventListener('travelShop', 'itemsUpdated', onItemsUpdated);
        wsHooked = true;
        console.log('[Abroad Stock Alert] Successfully attached listener to WebsocketHandler (travelShop -> itemsUpdated).');
        return true;
      } catch (err) {
        console.warn('[Abroad Stock Alert] Failed to attach WebsocketHandler listener:', err);
      }
    }
    return false;
  }

  // ---------------- TIER 2: React DOM Scanner & MutationObserver ----------------
  function scanDomShopItems() {
    if (!isAbroad()) return;
    const country = getActiveCountry();

    // Find all item rows in modern travel React layout
    const rows = document.querySelectorAll('[class*="row___"]');
    if (!rows.length) return;

    rows.forEach((row) => {
      // 1. Resolve item name
      const nameBtn = row.querySelector('button[class*="itemNameButton"], [class*="itemName"]');
      if (!nameBtn) return;
      const name = (nameBtn.textContent || '').trim();
      if (!name) return;

      // 2. Resolve item ID (from /images/items/{id}/medium)
      let itemId = null;
      const img = row.querySelector('img[src*="/images/items/"]');
      if (img) {
        const m = img.src.match(/\/images\/items\/(\d+)\//);
        if (m) itemId = parseInt(m[1], 10);
      }

      if (itemId !== null) {
        idToNameMap.set(itemId, name);
      }

      // 2.5 In-line Alert/Ignore Toggle Button on item row
      const itemKey = itemId !== null ? itemId : name;
      let rowToggle = row.querySelector('.torn-abroad-row-toggle');
      const isIgnored = isItemIgnored(itemKey, name);

      if (!rowToggle) {
        rowToggle = document.createElement('button');
        rowToggle.type = 'button';
        rowToggle.className = 'torn-abroad-row-toggle';
        Object.assign(rowToggle.style, {
          background: 'transparent',
          border: 'none',
          padding: '2px 4px',
          marginLeft: '6px',
          cursor: 'pointer',
          fontSize: '13px',
          verticalAlign: 'middle',
          userSelect: 'none',
          transition: 'transform 0.15s ease',
        });
        if (nameBtn.parentNode) {
          nameBtn.parentNode.insertBefore(rowToggle, nameBtn.nextSibling);
        }
      }

      rowToggle.textContent = isIgnored ? '🔕' : '🔔';
      rowToggle.title = isIgnored
        ? `${name}: Alert Ignored (Click to enable restock alert)`
        : `${name}: Alert Active (Click to ignore restock alert)`;
      rowToggle.style.opacity = isIgnored ? '0.35' : '1';
      rowToggle.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const nextState = !isItemIgnored(itemKey, name);
        setItemIgnored(itemKey, nextState, name);
        rowToggle.textContent = nextState ? '🔕' : '🔔';
        rowToggle.title = nextState
          ? `${name}: Alert Ignored (Click to enable restock alert)`
          : `${name}: Alert Active (Click to ignore restock alert)`;
        rowToggle.style.opacity = nextState ? '0.35' : '1';

        showInfoToast(
          nextState ? '🔕 Item Ignored' : '🔔 Alert Active',
          `${name} will ${nextState ? 'be ignored' : 'now trigger restock alerts'}.`,
          !nextState
        );
      };

      // 3. Resolve stock number
      const isSoldOut = row.className.includes('soldOut') || row.querySelector('[class*="soldOut"]');
      let stock = null;

      if (isSoldOut) {
        stock = 0;
      } else {
        // Look for cell containing text "stock X"
        const cells = row.querySelectorAll('[class*="cell___"], div');
        for (const cell of cells) {
          const text = (cell.textContent || '').trim();
          const sm = text.match(/^stock\s*([\d,]+)/i);
          if (sm) {
            stock = parseInt(sm[1].replace(/,/g, ''), 10);
            break;
          }
        }
      }

      if (stock !== null) {
        const key = itemId !== null ? itemId : name;
        const hasPrev = stockState.has(key);
        const prevStock = hasPrev ? stockState.get(key) : null;

        stockState.set(key, stock);

        // Alert if stock increased
        if (hasPrev && stock > prevStock) {
          handleRestock(key, stock, prevStock, country);
        }
      }
    });

    renderStatusBadge(country, stockState.size);
  }

  function setupDomObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const travelRoot = document.getElementById('travel-root') || document.querySelector('#mainContainer') || document.body;
    if (!travelRoot) return;

    observer = new MutationObserver(() => {
      scanDomShopItems();
      if (!wsHooked) tryHookWebsocketHandler();
    });

    observer.observe(travelRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    // Initial DOM scan
    scanDomShopItems();
  }

  // ---------------- Boot & Lifecycle ----------------
  function boot() {
    autoCheckForUpdates();

    if (!isAbroad()) {
      // Check again shortly in case attributes are mounting
      setTimeout(() => {
        if (isAbroad()) boot();
      }, 1000);
      return;
    }

    // Try hooking WebSocket immediately
    tryHookWebsocketHandler();

    // Hook DOM
    setupDomObserver();

    // Interval heartbeat as secondary safety
    setInterval(() => {
      if (!wsHooked) tryHookWebsocketHandler();
      scanDomShopItems();
    }, 1000);
  }

  pageWindow.__TORN_ABROAD_STOCK_ALERT_RECHECK__ = () => {
    boot();
  };

  ['popstate', 'hashchange', 'pageshow'].forEach((evt) => {
    window.addEventListener(evt, () => {
      setTimeout(() => boot(), 300);
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[Abroad Stock Alert] Initialized with Dual Centrifugo WebSocket & React DOM Watch.');
})();
