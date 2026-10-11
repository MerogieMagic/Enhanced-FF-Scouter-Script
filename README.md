# ⚔️ FF Scouter V2 + BS Threat Border + War Stuff Enhanced

An all-in-one userscript for [Torn City](https://www.torn.com) combining real-time Fair Fight (FF) estimates, Battle Stats (BS) Threat Borders, live Hospitalization countdown timers, Smart War Sorting, travel tracking, and direct attack screen integrations.

---

## 🚀 One-Click Installation

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. Click the installation link below:
   
   👉 **[Click Here to Install Script](https://raw.githubusercontent.com/MerogieMagic/Enhanced-FF-Scouter-Script/main/ff_scouter_bs_enhanced.user.js)** 👈

Violentmonkey / Tampermonkey will automatically detect the script and prompt you to install.

---

## ✨ Features

- **🎯 Battle Stats Threat Borders & Badges**: Real-time color-coded threat borders and Battle Stats estimate badges across profile pages, faction rosters, mini-profiles, bounties, user lists, and hospital pages.
- **⚔️ Smart War & Hospital Sorting**:
  - Automatically prioritizes available targets at the top.
  - **Online** available targets sorted to the very top (lowest BS first).
  - **Idle** and **Offline** available targets follow in sequence.
  - Hospitalized targets sorted ascending by least hospital time remaining.
- **⏱️ Live Hospital Countdown Badges**:
  - Live ticking countdown badges directly in faction member rosters.
  - Clickable hospital badges to instantly preload and stage attacks.
  - Live countdown banner and on-model overlay timer directly on attack screens (`page.php?sid=attack`).
- **🔗 Universal Faction Chain Watcher Widget**:
  - Floating, draggable chain status widget persisting across all Torn pages.
  - Live hit counters (`current / milestone`), countdown timer (`mm:ss`), and respect modifier (`1.50x`).
  - Dynamic urgency color indicators: 🟢 Safe (> 120s), 🟡 Caution (60s–120s), 🔴 Danger (< 60s), ⚡ Panic (< 30s with edge flash).
  - Built-in zero-latency Web Audio chime alerts at 90s, 60s, and 30s (with 1-click mute toggle).
  - Instant `[⚡ Hit Target]` emergency shortcut to quickly open attack pages and prevent chain drops.
  - Dual-engine data sync: Reads native sidebar in real-time with zero API calls, with automatic API polling fallback.
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
- **Modifications & Enhancements**: GFOUR & Antigravity (MerogieMagic)
