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
- **✈️ Travel & Overseas Status Badges**:
  - In-flight destination badge with live remaining travel countdown.
  - Overseas / abroad country indicators.
- **📋 1-Click Fast Copy Button**: Instantly copy player Name and ID (`PlayerName [12345]`).

---

## 🎨 Colour Target & Threat Scale

| Colour | Hex | Battle Stats | Fair Fight | Difficulty Tier | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 🩵 **Sky Blue** | `#38bdf8` | **$< \text{5M}$** | $< 1.5$ | **Very Easy Target** | Guaranteed win; fast energy dump. |
| 🟦 **Royal Blue** | `#2563eb` | **$\text{5M} - \text{15M}$** | $1.5 - 2.2$ | **Easy Match** | Safe attack with very high win probability. |
| 🟩 **Light Green** | `#4ade80` | **$\text{15M} - \text{40M}$** | $2.2 - 3.0$ | **Moderate Match** | Fair fight; good balance of respect and win rate. |
| 🟧 **Orange** | `#f97316` | **$\text{40M} - \text{150M}$** | $3.0 - 3.8$ | **Moderate Challenge** | High threat; use temporary weapons/debuffs or group hit. |
| 🟥 **Crimson Red** | `#dc2626` | **$\ge \text{150M}$** | $\ge 3.8$ | **Cannot Win (Skip!)** | Titan target; do not solo hit unless assisted. |
| 🔘 **Muted Gray** | `rgba(160,160,160,0.4)` | *No Data* | *No Data* | **Unrated** | Target has no cached stats on FF Scouter. |

---

## ⚙️ Configuration & API Key

When viewing player profiles or faction pages, the script provides a setup link at the top of the page to enter your limited Torn API key for live member status and hospital updates.

---

## 📜 Authors & Credits

- **Original Authors**: rDacted, Weav3r, xentac
- **Modifications & Enhancements**: GFOUR & Antigravity (MerogieMagic)
