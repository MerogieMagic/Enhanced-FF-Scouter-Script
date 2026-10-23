# ⚔️ FF Scouter V2 + BS Threat Border + War Stuff Enhanced

An all-in-one userscript for [Torn City](https://www.torn.com) combining real-time Fair Fight (FF) estimates, Battle Stats (BS) Threat Borders, live Hospitalization countdown timers, Smart War Sorting, travel tracking, and direct attack screen integrations.

---

## 🚀 One-Click Installation

### 🖥️ Option 1: Desktop Browser (Tampermonkey / Violentmonkey)
1. Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. Click the installation links below:
   
   👉 **[Click Here to Install War Sorter PC Script (v2.99)](https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/ff_scouter_bs_enhanced.user.js)** 👈

   👉 **[Click Here to Install Mercenary Stakeout Radar PC (v1.20)](https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_mercenary_stakeout.user.js)** 👈

   👉 **[Click Here to Install Abroad Stock Restock Alert PC (v1.20)](https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_abroad_stock_alert.user.js)** 👈

---

### 📱 Option 2: Mobile (Torn PDA App)
Tailored specifically to Torn PDA's native script specifications (`###PDA-APIKEY###` auto-authentication, War Mode compatibility, re-injection singleton guards, mobile touch gestures, haptic feedback, and Web Audio unlock):

#### ✈️ Torn Abroad Stock Restock Alert (v1.20)
Zero-API real-time stock refill monitor for foreign shops abroad (Japan, South Africa, Switzerland, UAE, etc.):
1. In Torn PDA, navigate to **Settings** $\rightarrow$ **Advanced** $\rightarrow$ **User Scripts**.
2. Tap **Add Script / Link** (or `+`) and paste:
   
   👉 **`https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/torn_abroad_stock_alert.user.js`** 👈

- **Zero API Quota**: Hooks into Torn's native Centrifugo WebSocket (`travelShop` -> `itemsUpdated`) and React DOM. Consumes 0 API calls and 0 extra network bandwidth.
- **Dedicated Xanax Triumph Fanfare**: Plays a triumphant 4-note ascending fanfare when Xanax restocks in South Africa, plus standard double-beep for plushies/flowers/weapons.
- **Microsecond Restock Audio & Toast**: Audible alert + visual toast banner + item card green/gold glow outline.
- **Auto Update Checking**: Built-in 24h background auto-check and 1-tap `🔄 v1.20` on the status HUD.

#### 🎯 Torn PDA - Mercenary Stakeout Radar (v1.03 Lightweight)
Ultra-lightweight mobile surveillance radar for hospital exits, flight arrivals, and online activity:
1. In Torn PDA, navigate to **Settings** $\rightarrow$ **Advanced** $\rightarrow$ **User Scripts**.
2. Tap **Add Script / Link** (or `+`) and paste the direct Raw URL:
   
   👉 **`https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_stakeout_radar.user.js`** 👈

- **Streamlined Lightweight UI**: Bulky settings/triggers drawer removed entirely. Radar focuses 100% on target surveillance cards with zero screen occlusion or scroll traps.
- **Effortless Minimization**: Tap either the `−` header button or the `🎯 Stakeout Radar` header title bar to collapse the entire window into the floating pill (`[🎯 Radar (N) • ⚡ READY]`). Tap the pill anytime to restore.
- **Immediate Mobile Tap Engine**: Dual `ontouchend` and `onclick` binding eliminates touch latency and ensures 100% reliable button response across mobile WebViews.
- **Zero-Setup API Authentication**: Torn PDA injects your API key via `###PDA-APIKEY###` automatically (plus manual entry fallback).
- **Per-Target Inactive Limit**: Dynamic activity threshold selector directly on each card (`2m`, `5m`, `10m`, `15m`, `30m`, `60m`).
- **Touch & Haptic Gestures**: Long-press (550ms hold) or tap `🎯` on any card to toggle Stricken with haptic vibration feedback (`navigator.vibrate`).
- **Dynamic 1s Hospital Polling**: Rapid polling automatically engages when a target has $< 60$s in hospital, tracking overdue Torn server ticks (`+Xs tick`).
- **Energy & Drug Bells**: Procedurally synthesized golden bell chimes on 100% full energy (train reminder) and drug cooldown readiness.
- **Profile Integration**: 1-tap `[🎯 Stakeout]` button directly inside Torn profile headers.

#### ⚔️ Torn PDA - War Sorter Enhanced (v9.5)
Ranked war and faction roster combat optimizer:
1. Tap **Add Script / Link** and paste:

   👉 **`https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/tornpda_war_enhanced.user.js`** 👈

- **Onlines-First Smart Sorting**: Live online targets prioritized first, idle/offline following.
- **Strict 3 Significant Figures**: Perfectly formatted Battle Stats placed cleanly directly underneath player names.
- **War Mode Compatible**: Safe for Torn PDA's exclusive War Mode.


---

## ✨ Features

- **🎯 Battle Stats Threat Borders & Badges**: Real-time color-coded threat borders and Battle Stats estimate badges across profile pages, faction rosters, mini-profiles, bounties, user lists, and hospital pages.
- **⚔️ Smart War & Hospital Sorting**:
  - Automatically prioritizes available targets at the top.
  - **Online** available targets sorted to the very top (lowest BS first).
  - **Idle and Offline** available targets follow merged together (sorted purely by lowest BS first).
  - Hospitalized targets sorted ascending by least hospital time remaining.
- **⏱️ Live Hospital Countdown Badges**:
  - Live ticking countdown badges directly in faction member rosters.
  - Clickable hospital badges to instantly preload and stage attacks.
  - Live countdown banner and on-model overlay timer directly on attack screens (`page.php?sid=attack`).
- **📋 Custom Target List Manager & 📥 FF Scouter Target Finder**:
  - In-menu tools in Tampermonkey / Violentmonkey to configure emergency 1-hit punching bags or refresh FF Scouter's live inactive targets (`/api/v1/get-targets`).
  - Pre-seeded with curated inactive punching bags under Level 15 (e.g. DOMINODOM, L3MILK, Ghoad, fijimarie) with strict NPC/boss bans (Duke & Leslie excluded).
- **✈️ Travel & Overseas Status Badges**:
  - In-flight destination badge with live remaining travel countdown.
  - Overseas / abroad country indicators.
- **📋 1-Click Fast Copy Button**: Instantly copy player Name and ID (`PlayerName [12345]`).
- **🔄 In-Menu & Automatic Update Checker**:
  - 1-click manual `🔄 Check for Script Updates` in Tampermonkey / Violentmonkey extension menu.
  - Automatic 24-hour background check without intrusive prompts if already current.
  - Prompts and routes directly into the userscript manager's 1-click installer whenever a newer GitHub release is detected.

---

## 🎨 Dynamic Relative Threat Scale (Fair Fight Multiplier)

The script calculates target difficulty **dynamically relative to your currently logged-in account** using the **Fair Fight (FF)** multiplier from FF Scouter:

| Colour | Hex | Fair Fight (FF) | Difficulty Tier | Tactical Meaning |
| :--- | :--- | :--- | :--- | :--- |
| 🩵 **Sky Blue** | `#38bdf8` | **$< 1.50$** | **Very Easy Target** | Guaranteed win; fast energy dump. Target stats $\ll$ yours. |
| 🟦 **Royal Blue** | `#2563eb` | **$1.50 - 2.20$** | **Easy Match** | Safe hit with high win probability; reliable respect. |
| 🟩 **Light Green** | `#4ade80` | **$2.20 - 3.20$** | **Moderate Match** | Fair fight; peer match with high respect yield. |
| 🟧 **Orange** | `#f97316` | **$3.20 - 4.20$** | **Moderate Challenge** | Challenging; temporary debuff weapon recommended. |
| 🟥 **Crimson Red** | `#dc2626` | **$\ge 4.20$** | **Cannot Win (Skip!)** | Titan match; target stats $\gg$ yours. Do not solo hit. |
| 🔘 **Muted Gray** | `rgba(160,160,160,0.4)` | *No Data* | **Unrated** | Target has no cached stats on FF Scouter. |

---

## ⚙️ Configuration & API Key

The script is **100% generic** and contains **no hardcoded keys or personal user credentials**. Anyone who installs the script simply enters their own Torn API key:

1. **Via Profile Banner**: When viewing a profile or attack page, click the `[ 🔑 Limited API key needed - click to add ]` banner.
2. **Via Script Extension Menu**: Click your Violentmonkey / Tampermonkey extension icon in your browser $\rightarrow$ select `🔑 Set / Change Torn & FF Scouter API Key`.
3. **Multi-Account Support**: The script automatically detects your active Torn Account ID and isolates API keys per account. When switching accounts or resetting keys, old evaluation caches are automatically purged.

---

## 📜 Authors & Credits

- **Original Authors**: rDacted, Weav3r, xentac
- **Modifications & Enhancements**: Merogie & Antigravity (MerogieMagic)
