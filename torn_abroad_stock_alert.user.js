// ==UserScript==
// @name         Torn Abroad Stock Restock Alert
// @namespace    https://github.com/MerogieMagic/Enhanced-FF-Scouter-Script
// @version      1.31
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

  const SCRIPT_VERSION = '1.31';
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
    277: { name: 'Cherry Blossom Plushie', type: 'Plushie' },
    276: { name: 'Peony', type: 'Flower' },
    247: { name: 'Katana', type: 'Melee' },
    11:  { name: 'Nodachi', type: 'Melee' },
    246: { name: 'Fireworks', type: 'Temporary' },
    294: { name: 'Bottle of Saké', type: 'Alcohol' },
    239: { name: 'Ninja Stars', type: 'Temporary' },
    278: { name: 'Kabuki Mask', type: 'Clothing' },
    433: { name: 'Sensu', type: 'Other' },
    279: { name: 'Maneki Neko', type: 'Other' },
    429: { name: 'Chopsticks', type: 'Other' },
    434: { name: 'Yakitori Lantern', type: 'Other' },

    // South Africa (Xanax!)
    206: { name: 'Xanax', type: 'Drug' },
    281: { name: 'Lion Plushie', type: 'Plushie' },
    282: { name: 'African Violet', type: 'Flower' },
    280: { name: 'Elephant Statue', type: 'Other' },

    // Switzerland
    273: { name: 'Chamois Plushie', type: 'Plushie' },
    272: { name: 'Edelweiss', type: 'Flower' },
    224: { name: 'Swiss Army Knife', type: 'Melee' },

    // UAE
    384: { name: 'Camel Plushie', type: 'Plushie' },
    385: { name: 'Tribulus Omanense', type: 'Flower' },

    // China
    274: { name: 'Panda Plushie', type: 'Plushie' },
    275: { name: 'Jade Buddha', type: 'Other' },

    // United Kingdom
    268: { name: 'Red Fox Plushie', type: 'Plushie' },
    266: { name: 'Nessie Plushie', type: 'Plushie' },
    267: { name: 'Heather', type: 'Flower' },

    // Argentina
    269: { name: 'Monkey Plushie', type: 'Plushie' },
    271: { name: 'Ceibo Flower', type: 'Flower' },

    // Hawaii
    264: { name: 'Orchid', type: 'Flower' },

    // Mexico
    258: { name: 'Jaguar Plushie', type: 'Plushie' },
    260: { name: 'Dahlia', type: 'Flower' },
    426: { name: 'Bottle of Tequila', type: 'Alcohol' },

    // Cayman Islands
    618: { name: 'Stingray Plushie', type: 'Plushie' },
    617: { name: 'Banana Orchid', type: 'Flower' },

    // Canada
    261: { name: 'Wolverine Plushie', type: 'Plushie' },
    263: { name: 'Crocus', type: 'Flower' },
    262: { name: 'Hockey Stick', type: 'Other' },
  };

  // ---------------- Configuration & State ----------------
  const STORAGE_KEY = 'torn_abroad_alert_config';
  const DEFAULT_CONFIG = {
    audioEnabled: true,
    volume: 0.85,
    showHud: true,
  };

  let config = Object.assign({}, DEFAULT_CONFIG);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
  } catch (e) {}

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
        margin-left: 4px;
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
