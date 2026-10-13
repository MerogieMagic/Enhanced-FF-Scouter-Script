import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime, timezone
import urllib.parse

from .database import get_latest_status, get_recent_events, get_connection
from .predict import get_all_predictions

CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class RestockAPIHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status_code=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html_str, status_code=200):
        body = html_str.encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/status':
            latest = get_latest_status()
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            tracked = cfg.get('tracked_items', {})
            
            # Filter specifically for tracked items or include all
            filtered = [item for item in latest if str(item['item_id']) in tracked]
            self._send_json({
                'timestamp': int(datetime.now(timezone.utc).timestamp()),
                'datetime_utc': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                'tracked_items': filtered,
                'all_items_count': len(latest)
            })

        elif path == '/api/events':
            events = get_recent_events(limit=50)
            self._send_json({
                'total_returned': len(events),
                'events': events
            })

        elif path == '/api/predictions':
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            tracked = cfg.get('tracked_items', {})
            predictions = get_all_predictions(tracked.keys())
            self._send_json({
                'timestamp': int(datetime.now(timezone.utc).timestamp()),
                'predictions': predictions
            })

        elif path == '/api/health':
            conn = get_connection()
            c = conn.cursor()
            c.execute('SELECT COUNT(*) as count FROM stock_snapshots')
            snap_count = c.fetchone()['count']
            c.execute('SELECT COUNT(*) as count FROM restock_events')
            event_count = c.fetchone()['count']
            conn.close()

            self._send_json({
                'status': 'healthy',
                'database': 'torn_city_shops.db',
                'total_snapshots': snap_count,
                'total_restock_events': event_count,
                'utc_time': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
            })

        elif path == '/' or path == '/dashboard':
            self._serve_dashboard()

        else:
            self.send_error(404, "Endpoint Not Found")

    def _serve_dashboard(self):
        html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Torn City Shop Restock & Prediction Dashboard</title>
    <style>
        :root {
            --bg: #0f172a; --card: #1e293b; --border: #334155;
            --text: #f8fafc; --muted: #94a3b8; --accent: #38bdf8;
            --green: #22c55e; --orange: #f97316; --red: #ef4444;
        }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 700; color: var(--accent); }
        .subtitle { font-size: 14px; color: var(--muted); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }
        .card-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
        .item-name { font-size: 18px; font-weight: 700; }
        .shop-name { font-size: 13px; color: var(--muted); }
        .stock-num { font-size: 32px; font-weight: 800; margin: 8px 0; }
        .stock-in { color: var(--green); }
        .stock-out { color: var(--red); }
        .eta-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; background: #334155; margin-top: 8px; }
        .buy-btn { display: inline-block; width: 100%; text-align: center; background: #0284c7; color: white; text-decoration: none; padding: 10px 0; border-radius: 6px; font-weight: 600; margin-top: 14px; }
        .buy-btn:hover { background: #0369a1; }
        table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; }
        th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
        th { background: #1e293b; color: var(--muted); font-weight: 600; }
        tr:hover { background: #334155; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <div class="title">🏪 Torn City Restock & Prediction Engine</div>
            <div class="subtitle">Live SQLite Time-Series Dataset & Periodicity Modeling</div>
        </div>
        <div id="live-clock" style="font-family: monospace; font-size: 16px; color: var(--accent);">--:--:-- UTC</div>
    </div>

    <div class="grid" id="stock-grid">Loading live stock data...</div>

    <div style="font-size: 18px; font-weight: 700; margin: 24px 0 12px; color: var(--accent);">📜 Recent Restock History</div>
    <table>
        <thead>
            <tr>
                <th>Time (UTC)</th>
                <th>Item</th>
                <th>Shop</th>
                <th>Units Added</th>
                <th>Total Stock</th>
                <th>Depletion Time</th>
            </tr>
        </thead>
        <tbody id="events-table">
            <tr><td colspan="6" style="text-align:center;">Loading event history...</td></tr>
        </tbody>
    </table>

    <script>
        const SHOP_STEPS = { 103: 'bitsnbobs', 110: 'pharmacy', 101: 'candy' };
        
        async function refreshData() {
            try {
                const [statusRes, predRes, eventRes] = await Promise.all([
                    fetch('/api/status').then(r => r.json()),
                    fetch('/api/predictions').then(r => r.json()),
                    fetch('/api/events').then(r => r.json())
                ]);

                document.getElementById('live-clock').textContent = statusRes.datetime_utc + ' UTC';

                const grid = document.getElementById('stock-grid');
                grid.innerHTML = '';

                statusRes.tracked_items.forEach(item => {
                    const pred = predRes.predictions[item.item_id] || {};
                    const step = SHOP_STEPS[item.shop_id] || 'city';
                    const isInStock = item.in_stock > 0;
                    
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.innerHTML = `
                        <div class="card-header">
                            <div>
                                <div class="item-name">${item.item_name}</div>
                                <div class="shop-name">${item.shop_name}</div>
                            </div>
                        </div>
                        <div class="stock-num ${isInStock ? 'stock-in' : 'stock-out'}">
                            ${item.in_stock.toLocaleString()}
                        </div>
                        <div>
                            <span class="eta-badge">Next Restock ETA: ${pred.eta_formatted || 'Calculating...'}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--muted); margin-top: 6px;">
                            Avg Interval: ${pred.avg_interval_minutes ? pred.avg_interval_minutes + ' min' : '~15 min'}
                        </div>
                        <a href="https://www.torn.com/shop.php?step=${step}" target="_blank" class="buy-btn">
                            ${isInStock ? '⚡ Open Shop & Buy' : 'Go to Shop'}
                        </a>
                    `;
                    grid.appendChild(card);
                });

                const tbody = document.getElementById('events-table');
                tbody.innerHTML = '';
                if (eventRes.events.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">No restock events recorded yet. Monitoring in progress...</td></tr>';
                } else {
                    eventRes.events.forEach(ev => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${ev.restock_datetime_utc}</td>
                            <td><strong>${ev.item_name}</strong></td>
                            <td>${ev.shop_name}</td>
                            <td style="color: var(--green); font-weight: 600;">+${ev.quantity_added.toLocaleString()}</td>
                            <td>${ev.new_stock.toLocaleString()}</td>
                            <td>${ev.duration_seconds ? ev.duration_seconds + 's' : 'Still In Stock'}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            } catch(e) {
                console.error("Fetch error:", e);
            }
        }

        refreshData();
        setInterval(refreshData, 5000);
    </script>
</body>
</html>"""
        self._send_html(html)

def run_server(host='127.0.0.1', port=8765):
    server = ThreadedHTTPServer((host, port), RestockAPIHandler)
    print(f"[*] Restock API & Dashboard running at http://{host}:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
