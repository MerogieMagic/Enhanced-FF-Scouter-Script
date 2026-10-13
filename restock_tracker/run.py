import sys
import threading
import time
import os

from restock_tracker.engine import RestockEngine
from restock_tracker.server import run_server

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    print("=" * 65)
    print("[*] TORN CITY SHOP RESTOCK TRACKER & PREDICTION BACKEND")
    print("=" * 65)

    engine = RestockEngine()
    engine_thread = threading.Thread(target=engine.start, daemon=True)
    engine_thread.start()

    time.sleep(1.0) # Let engine perform initial cycle

    server_host = engine.config.get('server', {}).get('host', '127.0.0.1')
    server_port = engine.config.get('server', {}).get('port', 8765)

    try:
        run_server(host=server_host, port=server_port)
    except KeyboardInterrupt:
        print("\n[Shutdown] Stopping tracker backend...")
        engine.stop()
        sys.exit(0)

if __name__ == '__main__':
    main()
