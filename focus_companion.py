"""
Torn Mercenary Stakeout - Windows OS Auto-Focus Companion
---------------------------------------------------------
A lightweight, zero-dependency local HTTP bridge for Windows.
When your Torn Mercenary Stakeout Radar detects an attackable target,
the userscript sends a quick signal to this local companion, which
instantly brings your Torn browser window to the absolute foreground
(Alt-Tabbing / raising the window even over other applications or games).

Usage:
    python focus_companion.py
    (Keep this terminal window running in the background during stakeouts)
"""

import http.server
import json
import socketserver
import sys
import ctypes
from ctypes import wintypes

# Ensure Windows console doesn't crash on emoji/Unicode output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = 8766
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

def bring_torn_browser_to_front():
    """Finds the browser window running Torn and brings it to the foreground."""
    target_hwnds = []

    def enum_windows_callback(hwnd, lParam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value
                # Match Torn window titles in Chrome, Edge, Firefox, Brave, Opera, etc.
                if "Torn" in title or "torn.com" in title.lower():
                    target_hwnds.append((hwnd, title))
        return True

    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(EnumWindowsProc(enum_windows_callback), 0)

    if not target_hwnds:
        return False, "No Torn browser window found"

    # Select the first matching window
    hwnd, title = target_hwnds[0]

    # 1. Restore window if minimized
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # 9 = SW_RESTORE
    else:
        user32.ShowWindow(hwnd, 5)  # 5 = SW_SHOW

    # 2. Bypass Windows LockSetForegroundWindow restriction
    # Simulating a null Alt-key event grants the thread foreground-activation permissions
    user32.keybd_event(0x12, 0, 0, 0)  # VK_MENU (Alt) down
    user32.keybd_event(0x12, 0, 2, 0)  # VK_MENU (Alt) up

    # 3. Bring to foreground and switch
    user32.SetForegroundWindow(hwnd)
    if hasattr(user32, "SwitchToThisWindow"):
        user32.SwitchToThisWindow(hwnd, True)

    return True, f"Brought '{title[:40]}' to front"

class FocusHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to keep terminal output clean and focused
        sys.stdout.write(f"[Focus Companion] {format % args}\n")
        sys.stdout.flush()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        if self.path.startswith("/focus"):
            success, msg = bring_torn_browser_to_front()
            status_text = "SUCCESS" if success else "NOT_FOUND"
            print(f"[*] [TRIGGER RECEIVED] Focus requested: {status_text} -> {msg}")
            payload = {"status": "ok", "success": success, "message": msg}
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        elif self.path.startswith("/health"):
            payload = {"status": "ok", "companion": "Torn Mercenary Stakeout Focus Bridge", "port": PORT}
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        else:
            payload = {"status": "ok", "hint": "Use /focus to raise Torn window"}
            self.wfile.write(json.dumps(payload).encode("utf-8"))

def main():
    print("=" * 65)
    print("  Torn Mercenary Stakeout - Windows OS Auto-Focus Companion")
    print("=" * 65)
    print(f"[*] Listening on http://127.0.0.1:{PORT}")
    print("[*] When a target becomes attackable, this script will")
    print("    automatically raise and focus your Torn browser window!")
    print("[*] Press Ctrl+C at any time to exit.\n")

    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), FocusHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Shutting down companion. Goodbye!")
    except Exception as e:
        print(f"[!] Server error: {e}")

if __name__ == "__main__":
    main()
