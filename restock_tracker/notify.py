import subprocess
import threading
import sys
import os

def play_chime():
    """Plays a pleasant 2-tone chime on Windows."""
    try:
        import winsound
        # Two-tone rising chime (A5 -> E6)
        winsound.Beep(880, 140)
        winsound.Beep(1318, 260)
    except Exception:
        # Fallback to terminal bell
        sys.stdout.write('\a')
        sys.stdout.flush()

def show_windows_toast(title, message):
    """Fires native Windows 10/11 toast notification using PowerShell."""
    try:
        ps_script = f'''
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $textNodes = $template.GetElementsByTagName("text")
        $textNodes.Item(0).AppendChild($template.CreateTextNode("{title}")) | Out-Null
        $textNodes.Item(1).AppendChild($template.CreateTextNode("{message}")) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Torn City Tracker").Show($toast)
        '''
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_script],
                         creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except Exception as e:
        print(f"[Notify Error] Toast failed: {e}")

def trigger_alert(item_name, shop_name, stock, price=None):
    """Triggers console banner, audio chime, and desktop notification asynchronously."""
    banner = f"""
============================================================
[!] RESTOCK ALERT: {item_name.upper()} IS BACK IN STOCK!
[*] Shop:  {shop_name}
[*] Stock: {stock:,} units available
============================================================
"""
    print(banner, flush=True)

    def _async_notify():
        play_chime()
        title = f"Torn Restock: {item_name}!"
        msg = f"{stock:,} units now available at {shop_name}!"
        show_windows_toast(title, msg)

    threading.Thread(target=_async_notify, daemon=True).start()
