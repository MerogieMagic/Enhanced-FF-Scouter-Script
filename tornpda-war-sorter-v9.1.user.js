// ==UserScript==
// @name         TornPDA War Sorter & Timers (Standalone FF Scouter)
// @namespace    http://tampermonkey.net/
// @version      9.1
// @description  Custom attack/status tags, battle-stats badges everywhere a name appears (faction, profile, bounty, mini-profile popup, forums, HoF, company, joblist, messages, index, hospital), configurable multi-field sort, and filters.
// @author       Tom Chew
// @match        https://www.torn.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      ffscouter.com
// ==/UserScript==

(function() {
    'use strict';

    const SETTINGS_KEY = 'tornpda-war-sorter-settings-v7';

    // 1. STYLES
    GM_addStyle(`
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
            background: #1b5e20;
            color: #fff !important;
            padding: 1px 7px;
            border-radius: 4px;
            text-decoration: none !important;
            font-weight: 700;
        }
        .tornpda-attack-link:active { background: #26881f; }

        /* Battle-stats badge, anchored right after the player name link and forced
           static/block so it can't inherit any absolute/sticky positioning from the
           avatar column - deliberately NOT a new table column, since this table's grid
           has a fixed column count and inserting a raw new cell corrupts the Score column. */
        .tornpda-stats-badge {
            position: static !important;
            display: block;
            width: fit-content;
            max-width: 90%;
            margin: 1px auto 0;
            font-size: 9px;
            font-weight: 700;
            line-height: 1.3;
            padding: 0 4px;
            border-radius: 3px;
            text-align: center;
            text-shadow: 0 1px 1px rgba(0,0,0,0.4);
        }

        .tornpda-ctrl-btn {
            width:36px; height:36px; padding:0; display:flex; justify-content:center; align-items:center;
            background-color:#222; color:#fff; border:1px solid #555; border-radius:6px; font-size:18px;
            box-shadow:0 2px 4px rgba(0,0,0,0.4); opacity:0.9;
        }

        .tornpda-panel {
            position:fixed; bottom:90px; left:56px; z-index:999999;
            width:210px; background:#1a1a1a; border:1px solid #444; border-radius:8px;
            color:#eee; font-size:12px; box-shadow:0 4px 12px rgba(0,0,0,0.5);
            padding:8px 10px 10px;
        }
        .tornpda-panel.tornpda-hide { display:none !important; }
        .tornpda-panel-header {
            display:flex; justify-content:space-between; align-items:center;
            font-weight:700; font-size:13px; margin-bottom:6px; border-bottom:1px solid #333; padding-bottom:4px;
        }
        .tornpda-panel-close { cursor:pointer; opacity:0.7; padding:0 4px; }
        .tornpda-panel-label { font-weight:700; opacity:0.8; margin:6px 0 2px; font-size:11px; text-transform:uppercase; }
        .tornpda-panel label { display:flex; align-items:center; gap:6px; padding:2px 0; }
        .tornpda-panel input[type=checkbox] { margin:0; }
        .tornpda-panel select {
            width:100%; background:#222; color:#eee; border:1px solid #444; border-radius:4px;
            padding:4px; margin-bottom:6px; font-size:12px;
        }
        .tornpda-apply-btn {
            width:100%; margin-top:4px; padding:6px; background:#2196F3; color:#fff; border:none;
            border-radius:4px; font-weight:700; font-size:12px; cursor:pointer;
        }
        .tornpda-apply-btn:active { background:#1976D2; }

        /* Inline variant used on profile/bounty pages, where the badge sits next to a
           name rather than centered under it in a table cell. */
        .tornpda-bounty-badge {
            position: static !important;
            display: inline-block !important;
            width: auto !important;
            max-width: none !important;
            margin: 0 0 0 6px !important;
            font-size: 11px !important;
            vertical-align: middle;
        }
        #tornpda-profile-ff-line {
            margin: 6px 0;
            font-weight: 700;
            font-size: 13px;
        }
        .tornpda-mini-ff-line {
            padding: 0 5px;
            font-weight: 700;
            font-size: 11px;
        }
    `);

    // 2. API CREDENTIALS
    function getApiKey() {
        try {
            let v3key = localStorage.getItem('ffsv3-configkey');
            if (v3key) return JSON.parse(v3key).value;
        } catch(e) {}
        return localStorage.getItem('limited_key') || null;
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
                GM_xmlhttpRequest({
                    method: "GET", url: url,
                    onload: r => resolve(safeJsonParse(r && r.responseText)),
                    onerror: () => resolve({}),
                    ontimeout: () => resolve({})
                });
            });
        }
    }

    // 3. STATE
    const memberData = {};
    const DEST_TABLE = {
        "mexico": "MX", "cayman islands": "CI", "canada": "CA",
        "hawaii": "HI", "united kingdom": "UK", "argentina": "AR",
        "switzerland": "SW", "japan": "JP", "china": "CN",
        "uae": "UAE", "south africa": "SA", "torn": "TC"
    };

    const SORT_FIELDS = [['none', 'None'], ['time', 'Time Remaining'], ['stats', 'Battle Stats'], ['level', 'Level']];
    const SORT_DIRS = [['asc', 'Ascending'], ['desc', 'Descending']];

    const DEFAULT_SETTINGS = {
        sort: { primaryField: 'none', primaryDir: 'asc', secondaryField: 'none', secondaryDir: 'asc' },
        activityFilter: { online: true, idle: true, offline: true },
        statusFilter: { okay: true, hospital: true, jail: true, traveling: true, abroad: true }
    };

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            const parsed = JSON.parse(raw);
            let sort = parsed.sort;
            if (!sort) {
                let field = 'none';
                if (parsed.sortMode === 'time' || parsed.sortByTime) field = 'time';
                else if (parsed.sortMode === 'ff') field = 'stats';
                sort = { primaryField: field, primaryDir: 'asc', secondaryField: 'none', secondaryDir: 'asc' };
            }
            return {
                sort: Object.assign({}, DEFAULT_SETTINGS.sort, sort),
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
        faction: location.href.startsWith('https://www.torn.com/factions.php'),
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

    // 4. HIJACK FF SCOUTER V3 CORE ENGINE (harmless no-op if that separate script isn't installed)
    function deactivateScouterEngine() {
        const ffBox = document.querySelector('[data-ff-filter-box]');
        if (!ffBox || ffBox.dataset.pdaHijacked) return;
        if (!ffBox.__ffHandle) return;

        ffBox.dataset.pdaHijacked = "true";
        ffBox.__ffHandle.getFilterSnapshot = function() {
            return {
                sortBy: "none",
                filterEnabled: false,
                activity: { online: true, idle: true, offline: true },
                status: { okay: true, traveling: true, hospital: true, jail: true, abroad: true, federal: true, fallen: true },
                levelMin: null, levelMax: null, ffMin: null, ffMax: null, statsMin: null, statsMax: null, lastActionMinSec: null, lastActionMaxSec: null
            };
        };
    }

    // 5. CONTROLS (faction war page only)
    if (PAGE.faction) {
    const ctrlContainer = document.createElement('div');
    ctrlContainer.style.cssText = 'position:fixed; bottom:90px; left:10px; z-index:999999; display:flex; flex-direction:column; gap:8px;';

    const sortBtn = document.createElement('button');
    sortBtn.innerText = '⇅';
    sortBtn.className = 'tornpda-ctrl-btn';

    const settingsBtn = document.createElement('button');
    settingsBtn.innerText = '⚙️';
    settingsBtn.className = 'tornpda-ctrl-btn';

    ctrlContainer.appendChild(sortBtn);
    ctrlContainer.appendChild(settingsBtn);
    document.body.appendChild(ctrlContainer);

    function describeSort() {
        if (settings.sort.primaryField === 'none') return 'Sorting off';
        const fieldLabel = (v) => SORT_FIELDS.find(f => f[0] === v)?.[1] ?? v;
        let text = `Sort: ${fieldLabel(settings.sort.primaryField)} (${settings.sort.primaryDir})`;
        if (settings.sort.secondaryField !== 'none') {
            text += `, then ${fieldLabel(settings.sort.secondaryField)} (${settings.sort.secondaryDir})`;
        }
        return text;
    }

    function refreshSortBtn() {
        sortBtn.style.backgroundColor = settings.sort.primaryField !== 'none' ? '#2196F3' : '#222';
        sortBtn.title = describeSort();
    }
    refreshSortBtn();

    // 5a. SORT PANEL (draft-based - only takes effect on Apply)
    const sortPanel = document.createElement('div');
    sortPanel.className = 'tornpda-panel tornpda-hide';
    let sortDraft = Object.assign({}, settings.sort);

    function buildSelect(options, value, onChange) {
        const select = document.createElement('select');
        options.forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            select.appendChild(opt);
        });
        select.value = value;
        select.addEventListener('change', (e) => onChange(e.target.value));
        return select;
    }

    function buildSortPanel() {
        sortPanel.textContent = '';

        const header = document.createElement('div');
        header.className = 'tornpda-panel-header';
        const title = document.createElement('span');
        title.textContent = 'Sort';
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tornpda-panel-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => sortPanel.classList.add('tornpda-hide'));
        header.appendChild(title);
        header.appendChild(closeBtn);
        sortPanel.appendChild(header);

        const primaryLabel = document.createElement('div');
        primaryLabel.className = 'tornpda-panel-label';
        primaryLabel.textContent = 'Primary field';
        sortPanel.appendChild(primaryLabel);
        sortPanel.appendChild(buildSelect(SORT_FIELDS, sortDraft.primaryField, (v) => { sortDraft.primaryField = v; }));
        sortPanel.appendChild(buildSelect(SORT_DIRS, sortDraft.primaryDir, (v) => { sortDraft.primaryDir = v; }));

        const secondaryLabel = document.createElement('div');
        secondaryLabel.className = 'tornpda-panel-label';
        secondaryLabel.textContent = 'Secondary field (tiebreak)';
        sortPanel.appendChild(secondaryLabel);
        sortPanel.appendChild(buildSelect(SORT_FIELDS, sortDraft.secondaryField, (v) => { sortDraft.secondaryField = v; }));
        sortPanel.appendChild(buildSelect(SORT_DIRS, sortDraft.secondaryDir, (v) => { sortDraft.secondaryDir = v; }));

        const applyBtn = document.createElement('button');
        applyBtn.className = 'tornpda-apply-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
            settings.sort = Object.assign({}, sortDraft);
            saveSettings();
            refreshSortBtn();
            renderAndSort();
            sortPanel.classList.add('tornpda-hide');
        });
        sortPanel.appendChild(applyBtn);
    }

    sortBtn.addEventListener('click', (e) => {
        e.preventDefault();
        panel.classList.add('tornpda-hide');
        sortDraft = Object.assign({}, settings.sort);
        buildSortPanel();
        sortPanel.classList.toggle('tornpda-hide');
    });
    document.body.appendChild(sortPanel);

    // 5b. FILTER SETTINGS PANEL
    const panel = document.createElement('div');
    panel.className = 'tornpda-panel tornpda-hide';

    const ACTIVITY_OPTIONS = [['online', 'Online'], ['idle', 'Idle'], ['offline', 'Offline']];
    const STATUS_OPTIONS = [
        ['okay', 'Okay'], ['hospital', 'Hospital'], ['jail', 'Jail'],
        ['traveling', 'Traveling'], ['abroad', 'Abroad']
    ];

    function buildCheckboxRow(groupName, key, label, checked) {
        const row = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.dataset.group = groupName;
        input.dataset.key = key;
        row.appendChild(input);
        row.appendChild(document.createTextNode(label));
        return row;
    }

    function buildPanel() {
        panel.textContent = '';

        const header = document.createElement('div');
        header.className = 'tornpda-panel-header';
        const title = document.createElement('span');
        title.textContent = 'Filters';
        const closeBtn = document.createElement('span');
        closeBtn.className = 'tornpda-panel-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => panel.classList.add('tornpda-hide'));
        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        const activityLabel = document.createElement('div');
        activityLabel.className = 'tornpda-panel-label';
        activityLabel.textContent = 'Activity';
        panel.appendChild(activityLabel);
        ACTIVITY_OPTIONS.forEach(([key, label]) => {
            panel.appendChild(buildCheckboxRow('activity', key, label, settings.activityFilter[key]));
        });

        const statusLabel = document.createElement('div');
        statusLabel.className = 'tornpda-panel-label';
        statusLabel.textContent = 'Status';
        panel.appendChild(statusLabel);
        STATUS_OPTIONS.forEach(([key, label]) => {
            panel.appendChild(buildCheckboxRow('status', key, label, settings.statusFilter[key]));
        });

        panel.addEventListener('change', (e) => {
            const t = e.target;
            if (!t.matches('input[type=checkbox]')) return;
            const group = t.dataset.group === 'activity' ? settings.activityFilter : settings.statusFilter;
            group[t.dataset.key] = t.checked;
            saveSettings();
            renderAndSort();
        });
    }
    buildPanel();
    document.body.appendChild(panel);

    settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sortPanel.classList.add('tornpda-hide');
        panel.classList.toggle('tornpda-hide');
    });
    } // end PAGE.faction controls

    // 6. HELPERS
    function shortenDest(name) { return DEST_TABLE[name.trim().toLowerCase()] || name; }

    function formatTime(sec) {
        let h = Math.floor(sec / 3600).toString().padStart(2, '0');
        let m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
        let s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function getMemberCell(li) {
        return li.querySelector('.member') || li;
    }

    function getPlayerId(li) {
        const memberCell = getMemberCell(li);
        const a = memberCell.querySelector('a[href*="XID="]');
        return a ? a.href.match(/XID=(\d+)/)?.[1] : null;
    }

    // Attack/status tag: reuse the native .status cell when present (fully replacing its
    // content), otherwise insert a new cell after .member. This is the one place we still
    // add a cell, since the status text needs somewhere dedicated to live; the battle-stats
    // badge below deliberately avoids this by living inside .member instead.
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

    // Battle-stats badge lives INSIDE the .member cell, directly under the player name -
    // not a new table column, so it can never disturb Level/Score/Status layout. Anchored
    // right after the name link (not appended at the end of the whole cell) so it can't
    // land near the avatar icon and inherit any absolute/sticky positioning from there.
    function getStatsBadge(li) {
        let badge = li.querySelector('.tornpda-stats-badge');
        if (badge) return badge;
        const memberCell = li.querySelector('.member');
        if (!memberCell) return null;
        badge = document.createElement('span');
        badge.className = 'tornpda-stats-badge';
        const nameLink = memberCell.querySelector('a[href*="XID="]');
        if (nameLink && nameLink.parentNode) {
            nameLink.parentNode.insertBefore(badge, nameLink.nextSibling);
        } else {
            memberCell.appendChild(badge);
        }
        return badge;
    }

    function attackUrl(playerId) {
        return `https://www.torn.com/page.php?sid=attack&user2ID=${playerId}`;
    }

    function statusKeyFor(state) {
        switch (state) {
            case 'Hospital': return 'hospital';
            case 'Jail': return 'jail';
            case 'Traveling': return 'traveling';
            case 'Abroad': return 'abroad';
            case 'Okay': return 'okay';
            default: return null;
        }
    }

    function collectGroup(li) {
        const group = [li];
        let next = li.nextElementSibling;
        while (next && !next.classList.contains('table-row') && !next.classList.contains('enemy') && !next.classList.contains('your')) {
            group.push(next);
            next = next.nextElementSibling;
        }
        return group;
    }

    function getFieldValue(li, m, field, now) {
        if (field === 'time') {
            if (m.state === 'Hospital' || m.state === 'Jail') return Math.max(0, m.until - now);
            return null;
        }
        if (field === 'stats') {
            return (!m.ffNoData && m.bsEstimate !== undefined) ? m.bsEstimate : null;
        }
        if (field === 'level') {
            const cell = li.querySelector('.lvl, .level');
            const val = cell ? parseInt(cell.textContent, 10) : NaN;
            return Number.isFinite(val) ? val : null;
        }
        return null;
    }

    function compareField(aVal, bVal, dir) {
        const aMissing = aVal === null;
        const bMissing = bVal === null;
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
    }

    function reorderRows(ul, entries) {
        if (settings.sort.primaryField === 'none') return;
        const now = Date.now() / 1000;
        const scored = entries.map(e => ({
            group: e.group,
            primaryVal: getFieldValue(e.li, e.m, settings.sort.primaryField, now),
            secondaryVal: getFieldValue(e.li, e.m, settings.sort.secondaryField, now)
        }));
        scored.sort((a, b) => {
            const primaryCmp = compareField(a.primaryVal, b.primaryVal, settings.sort.primaryDir);
            if (primaryCmp !== 0) return primaryCmp;
            return compareField(a.secondaryVal, b.secondaryVal, settings.sort.secondaryDir);
        });
        scored.forEach(entry => {
            entry.group.forEach(node => ul.appendChild(node));
        });
    }

    // 6b. STANDALONE FF SCOUTER PREDICTION
    const FF_API_BASE = 'https://ffscouter.com/api/v1';
    const FF_CACHE_TTL_MS = 60 * 60 * 1000;
    const FF_BATCH_SIZE = 200;
    const FF_OLD_ESTIMATE_SEC = 14 * 24 * 60 * 60;
    const FF_PALETTE = ["#1734e8", "#1788e8", "#17dbe8", "#17e8a1", "#17e84e", "#34e817", "#88e817", "#dbe817", "#e8a117", "#e84e17", "#e81734"];

    function ffToColor(ff) {
        const clamped = Math.min(5, Math.max(1, ff));
        const idx = Math.floor((clamped - 1) / 4 * 10);
        return FF_PALETTE[idx] ?? "#000000";
    }

    function contrastColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 0.299 + g * 0.587 + b * 0.114) > 126 ? '#000' : '#fff';
    }

    // FIFO queue for FF fetches, so stale players get processed in the order they went
    // stale rather than by Object.keys(memberData) order. Plain objects enumerate
    // integer-like keys (player IDs) in ascending numeric order regardless of insertion
    // order, which meant lower/older account IDs always got fetched first and newer
    // (often lower-level) accounts kept getting pushed to the back every single cycle.
    let ffQueue = [];
    const ffQueued = new Set();

    function enqueueStaleIds() {
        const now = Date.now();
        Object.keys(memberData).forEach(id => {
            const m = memberData[id];
            const stale = !m.ffFetchedAt || (now - m.ffFetchedAt) > FF_CACHE_TTL_MS;
            if (stale && !ffQueued.has(id)) {
                ffQueue.push(id);
                ffQueued.add(id);
            }
        });
    }

    async function fetchFFScores() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        enqueueStaleIds();
        if (ffQueue.length === 0) return;

        const batch = ffQueue.splice(0, FF_BATCH_SIZE);
        batch.forEach(id => ffQueued.delete(id));
        const url = `${FF_API_BASE}/get-stats?key=${apiKey}&targets=${batch.join(',')}`;
        const data = await fetchAPI(url);

        const fetchedAt = Date.now();
        if (!Array.isArray(data)) {
            batch.forEach(id => { if (memberData[id]) memberData[id].ffFetchedAt = fetchedAt; });
            return;
        }

        const seen = new Set();
        data.forEach(r => {
            if (!r || !r.player_id || !memberData[r.player_id]) return;
            seen.add(String(r.player_id));
            const m = memberData[r.player_id];
            m.ffFetchedAt = fetchedAt;
            if (r.fair_fight && r.last_updated) {
                m.ff = r.fair_fight;
                m.ffLastUpdated = r.last_updated;
                m.bsEstimate = r.bs_estimate;
                m.bsEstimateHuman = r.bs_estimate_human;
                m.ffNoData = false;
            } else {
                m.ffNoData = true;
            }
        });
        batch.forEach(id => {
            if (!seen.has(String(id)) && memberData[id]) {
                memberData[id].ffFetchedAt = fetchedAt;
                memberData[id].ffNoData = true;
            }
        });
    }

    function renderStatsBadge(badge, m) {
        if (m.ffNoData || m.bsEstimateHuman === undefined) {
            badge.textContent = '';
            badge.style.backgroundColor = '';
            badge.style.color = '';
            badge.title = '';
            return;
        }
        const bg = ffToColor(m.ff);
        badge.style.backgroundColor = bg;
        badge.style.color = contrastColor(bg);
        badge.textContent = m.bsEstimateHuman;
        let ffText = m.ff.toFixed(2);
        if (m.ffLastUpdated && (Date.now() / 1000 - m.ffLastUpdated) > FF_OLD_ESTIMATE_SEC) {
            ffText += ' (old)';
        }
        badge.title = `Fair fight: ${ffText}`;
    }

    function setStatusContent(statusBox, text, url) {
        statusBox.textContent = '';
        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.className = 'tornpda-attack-link';
            a.textContent = text;
            a.addEventListener('click', (e) => e.stopPropagation());
            statusBox.appendChild(a);
        } else {
            statusBox.appendChild(document.createTextNode(text));
        }
    }

    // 7. DIRECT API POLLING (faction status + flights)
    const FLIGHT_RETRY_COOLDOWN = { "Prem. Req": 5 * 60, "Unknown": 60 };

    async function fetchFlightData(playerId, apiKey) {
        let data = await fetchAPI(`https://ffscouter.com/api/v1/player-flights?key=${apiKey}&target=${playerId}`);
        if (data && data.current && data.current.latest_arrival_time) {
            memberData[playerId].flightLatest = data.current.latest_arrival_time;
            memberData[playerId].flightError = null;
        } else {
            const errType = (data && data.code === 19) ? "Prem. Req" : "Unknown";
            memberData[playerId].flightError = errType;
            memberData[playerId].flightRetryAfter = Date.now() / 1000 + (FLIGHT_RETRY_COOLDOWN[errType] || 60);
        }
    }

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
                data.members.forEach(m => {
                    if (!memberData[m.id]) memberData[m.id] = {};
                    memberData[m.id].state = m.status.state;
                    memberData[m.id].until = m.status.until || 0;
                    memberData[m.id].desc = m.status.description || "";
                    memberData[m.id].activity = m.last_action && m.last_action.status
                        ? m.last_action.status.toLowerCase() : null;

                    if (m.status.state === "Traveling") {
                        const match = m.status.description.match(/Traveling from ([\S ]+) to ([\S ]+)/);
                        if (match) {
                            memberData[m.id].travelDir = (shortenDest(match[1]) === "TC") ? `► ${shortenDest(match[2])}` : `◄ ${shortenDest(match[1])}`;
                        }
                        const now = Date.now() / 1000;
                        const needsFetch = !memberData[m.id].flightLatest || memberData[m.id].flightLatest < now;
                        const offCooldown = !memberData[m.id].flightRetryAfter || memberData[m.id].flightRetryAfter < now;
                        if (needsFetch && offCooldown) {
                            fetchFlightData(m.id, apiKey);
                        }
                    }
                });
            }
        }
        fetchFFScores();
    }

    // 8. UNIFIED RENDER & SORT PIPELINE
    function renderAndSort() {
        deactivateScouterEngine();

        const lists = document.querySelectorAll('ul.members-list, ul.member-list, .table-body');
        const now = Date.now() / 1000;

        lists.forEach(ul => {
            const items = Array.from(ul.querySelectorAll(':scope > .table-row, :scope > li.enemy, :scope > li.your'));
            const entries = [];

            items.forEach(li => {
                const playerId = getPlayerId(li);
                if (!playerId || !memberData[playerId]) return;

                const m = memberData[playerId];

                const statusBox = getStatusBox(li);
                if (!statusBox) return;

                const badge = getStatsBadge(li);
                if (badge) renderStatsBadge(badge, m);

                statusBox.classList.remove('hosp', 'okay');

                if (m.state === "Hospital" || m.state === "Jail") {
                    let rem = Math.max(0, m.until - now);
                    setStatusContent(statusBox, `${m.state === "Hospital" ? "🏥" : "🚓"} ${formatTime(rem)}`, null);
                    statusBox.classList.add('hosp');
                } else if (m.state === "Traveling") {
                    let dir = m.travelDir || "✈️ Traveling";
                    let text;
                    if (m.flightError) text = `${dir} (${m.flightError})`;
                    else if (m.flightLatest) {
                        let rem = Math.max(0, m.flightLatest - now);
                        text = rem <= 0 ? `${dir} (Landed)` : `${dir} (Est: ${formatTime(rem)})`;
                    } else text = `${dir} (...)`;
                    setStatusContent(statusBox, text, null);
                } else if (m.state === "Abroad") {
                    setStatusContent(statusBox, `📍 ${shortenDest(m.desc.replace("In ", ""))}`, null);
                } else if (m.state === "Okay") {
                    setStatusContent(statusBox, "⚔️ Okay", attackUrl(playerId));
                    statusBox.classList.add('okay');
                } else {
                    setStatusContent(statusBox, m.state, null);
                }

                const statusKey = statusKeyFor(m.state);
                const statusOk = !statusKey || settings.statusFilter[statusKey];
                const activityOk = !m.activity || settings.activityFilter[m.activity] !== false;
                const visible = statusOk && activityOk;

                const group = collectGroup(li);
                group.forEach(node => {
                    if (visible) node.classList.remove('tornpda-hide');
                    else node.classList.add('tornpda-hide');
                });

                entries.push({ li, m, group });
            });

            reorderRows(ul, entries);
        });
    }

    // 8b. PROFILE PAGE: a stats line near the player's name
    function initProfilePage() {
        const match = location.href.match(/XID=(\d+)/);
        if (!match) return;
        const targetId = match[1];
        memberData[targetId] = memberData[targetId] || {};

        function renderProfileLine() {
            const m = memberData[targetId];
            if (m.ffNoData || m.bsEstimateHuman === undefined) return;

            let line = document.getElementById('tornpda-profile-ff-line');
            if (!line) {
                const h4 = document.querySelector('h4');
                if (!h4) return; // page not ready yet - retry next tick
                line = document.createElement('div');
                line.id = 'tornpda-profile-ff-line';
                h4.after(line);
            }
            const bg = ffToColor(m.ff);
            line.style.color = bg;
            let ffText = m.ff.toFixed(2);
            if (m.ffLastUpdated && (Date.now() / 1000 - m.ffLastUpdated) > FF_OLD_ESTIMATE_SEC) {
                ffText += ' (old)';
            }
            line.textContent = `Est. Battle Stats: ${m.bsEstimateHuman} (Fair Fight ${ffText})`;
        }

        fetchFFScores();
        setInterval(fetchFFScores, 60000);
        setInterval(renderProfileLine, 1000);
    }

    // 8c. BOUNTY LISTINGS: a stats badge next to each target's name.
    // Selector is a best-effort guess at "any link that identifies a target by XID" since
    // Torn's bounty page markup wasn't available to check directly - if targets aren't
    // getting badges, the real row/name markup is needed to fix this properly.
    function initBountyPage() {
        function scanAndRender() {
            const links = document.querySelectorAll('a[href*="XID="]');
            links.forEach(a => {
                const idMatch = a.href.match(/XID=(\d+)/);
                if (!idMatch) return;
                const id = idMatch[1];
                if (!memberData[id]) memberData[id] = {};

                let badge = a.nextElementSibling;
                if (!badge || !badge.classList || !badge.classList.contains('tornpda-bounty-badge')) {
                    badge = document.createElement('span');
                    badge.className = 'tornpda-stats-badge tornpda-bounty-badge';
                    a.parentNode.insertBefore(badge, a.nextSibling);
                }
                renderStatsBadge(badge, memberData[id]);
            });
        }

        fetchFFScores();
        setInterval(fetchFFScores, 60000);
        setInterval(scanAndRender, 2000);
    }

    // 8d. GENERIC NAME BADGES: shared by company/joblist/messages/index/hospital/
    // userlist/forums/HoF - each just supplies a list of CSS selectors for the elements
    // that represent a player's name/row on that page. Mirrors classic FF Scouter's
    // apply_ff_gauge(), but a text badge instead of an SVG arrow.
    function getPlayerIdFromElement(el) {
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

    function initGenericNameBadges(selectors) {
        function scan() {
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    const id = getPlayerIdFromElement(el);
                    if (!id) return;
                    if (!memberData[id]) memberData[id] = {};
                    let badge = el.querySelector(':scope > .tornpda-bounty-badge');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'tornpda-stats-badge tornpda-bounty-badge';
                        el.appendChild(badge);
                    }
                    renderStatsBadge(badge, memberData[id]);
                });
            });
        }

        fetchFFScores();
        setInterval(fetchFFScores, 60000);
        setInterval(scan, 2000);
    }

    // 8e. MINI-PROFILE POPUP: runs on every page, since this popup can appear anywhere
    // a player name is clicked. Uses #profile-mini-root, the reliable selector confirmed
    // in the newer FF Scouter source (the old script's guessed class name is unstable).
    function initMiniProfile() {
        function scan() {
            const miniRoot = document.getElementById('profile-mini-root');
            if (!miniRoot) return;
            const id = getPlayerIdFromElement(miniRoot);
            if (!id) return;
            if (!memberData[id]) memberData[id] = {};

            if (miniRoot.dataset.tornpdaLastId !== id) {
                miniRoot.dataset.tornpdaLastId = id;
                const stale = miniRoot.querySelector('.tornpda-mini-ff-line');
                if (stale) stale.remove();
            }

            const m = memberData[id];
            if (m.ffNoData || m.bsEstimateHuman === undefined) return;

            let line = miniRoot.querySelector('.tornpda-mini-ff-line');
            if (!line) {
                const description = miniRoot.querySelector('.description');
                if (!description) return;
                line = document.createElement('div');
                line.className = 'tornpda-mini-ff-line';
                description.appendChild(line);
            }
            const bg = ffToColor(m.ff);
            line.style.color = bg;
            let ffText = m.ff.toFixed(2);
            if (m.ffLastUpdated && (Date.now() / 1000 - m.ffLastUpdated) > FF_OLD_ESTIMATE_SEC) {
                ffText += ' (old)';
            }
            line.textContent = `Est: ${m.bsEstimateHuman} (FF ${ffText})`;
        }

        fetchFFScores();
        setInterval(fetchFFScores, 60000);
        setInterval(scan, 1000);
    }

    // 9. INSTANTIATION ENGINE
    if (PAGE.faction) {
        updateFactionData();
        setInterval(updateFactionData, 30000);
        setInterval(renderAndSort, 1000);
        new MutationObserver(deactivateScouterEngine).observe(document.body, { childList: true, subtree: true });
    } else if (PAGE.profile) {
        initProfilePage();
    } else if (PAGE.bounty) {
        initBountyPage();
    } else if (PAGE.company || PAGE.joblist) {
        initGenericNameBadges(['.employee', '.director']);
    } else if (PAGE.messages || PAGE.index || PAGE.hospital || PAGE.userlist) {
        initGenericNameBadges(['.name']);
    } else if (PAGE.forums) {
        initGenericNameBadges(['.last-poster', '.starter', '.last-post', '.poster']);
    } else if (PAGE.hof) {
        initGenericNameBadges(['[class^="userInfoBox__"]']);
    }

    // Mini-profile popup can appear on top of any page, including the ones above, so it
    // always runs regardless of which branch fired.
    initMiniProfile();
})();
