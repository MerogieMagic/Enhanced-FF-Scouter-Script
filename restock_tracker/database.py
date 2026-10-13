import sqlite3
import os
from datetime import datetime, timezone

DB_FILE = os.path.join(os.path.dirname(__file__), 'torn_city_shops.db')

def get_connection():
    conn = sqlite3.connect(DB_FILE, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    c = conn.cursor()
    
    # 1. Complete item stock snapshots (time-series dataset)
    c.execute('''
    CREATE TABLE IF NOT EXISTS stock_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime_utc TEXT NOT NULL,
        hour_utc INTEGER NOT NULL,
        minute_utc INTEGER NOT NULL,
        second_utc INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        shop_id INTEGER NOT NULL,
        shop_name TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        in_stock INTEGER NOT NULL,
        price INTEGER,
        delta INTEGER NOT NULL DEFAULT 0
    )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_snapshots_item_ts ON stock_snapshots(item_id, timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON stock_snapshots(timestamp)')

    # 2. Discrete restock events (for interval & periodicity modeling)
    c.execute('''
    CREATE TABLE IF NOT EXISTS restock_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        shop_id INTEGER NOT NULL,
        shop_name TEXT NOT NULL,
        restock_timestamp INTEGER NOT NULL,
        restock_datetime_utc TEXT NOT NULL,
        restock_minute INTEGER NOT NULL,
        restock_second INTEGER NOT NULL,
        previous_stock INTEGER NOT NULL,
        new_stock INTEGER NOT NULL,
        quantity_added INTEGER NOT NULL,
        depleted_timestamp INTEGER,
        depleted_datetime_utc TEXT,
        duration_seconds INTEGER,
        depletion_rate_per_sec REAL
    )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_events_item_ts ON restock_events(item_id, restock_timestamp)')

    # 3. Last known state for quick lookups & delta calculation
    c.execute('''
    CREATE TABLE IF NOT EXISTS latest_stock (
        item_id INTEGER PRIMARY KEY,
        item_name TEXT NOT NULL,
        shop_id INTEGER NOT NULL,
        shop_name TEXT NOT NULL,
        in_stock INTEGER NOT NULL,
        price INTEGER,
        last_updated_ts INTEGER NOT NULL,
        last_updated_utc TEXT NOT NULL,
        last_restock_ts INTEGER,
        last_restock_utc TEXT,
        last_restock_amount INTEGER
    )
    ''')

    conn.commit()
    conn.close()

def record_snapshot(shop_id, shop_name, item_id, item_name, in_stock, price, delta, ts=None):
    if ts is None:
        ts = int(datetime.now(timezone.utc).timestamp())
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
    INSERT INTO stock_snapshots (
        timestamp, datetime_utc, hour_utc, minute_utc, second_utc, day_of_week,
        shop_id, shop_name, item_id, item_name, in_stock, price, delta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        ts, dt.strftime('%Y-%m-%d %H:%M:%S'), dt.hour, dt.minute, dt.second, dt.weekday(),
        shop_id, shop_name, item_id, item_name, in_stock, price, delta
    ))
    conn.commit()
    conn.close()

def record_restock_event(item_id, item_name, shop_id, shop_name, prev_stock, new_stock, added, ts=None):
    if ts is None:
        ts = int(datetime.now(timezone.utc).timestamp())
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
    INSERT INTO restock_events (
        item_id, item_name, shop_id, shop_name, restock_timestamp, restock_datetime_utc,
        restock_minute, restock_second, previous_stock, new_stock, quantity_added
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        item_id, item_name, shop_id, shop_name, ts, dt.strftime('%Y-%m-%d %H:%M:%S'),
        dt.minute, dt.second, prev_stock, new_stock, added
    ))
    event_id = c.lastrowid
    conn.commit()
    conn.close()
    return event_id

def mark_depleted(item_id, ts=None):
    if ts is None:
        ts = int(datetime.now(timezone.utc).timestamp())
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    
    conn = get_connection()
    c = conn.cursor()
    # Find latest un-depleted restock event for this item
    c.execute('''
    SELECT id, restock_timestamp, new_stock FROM restock_events
    WHERE item_id = ? AND depleted_timestamp IS NULL
    ORDER BY restock_timestamp DESC LIMIT 1
    ''', (item_id,))
    row = c.fetchone()
    if row:
        event_id = row['id']
        r_ts = row['restock_timestamp']
        dur = max(1, ts - r_ts)
        rate = row['new_stock'] / dur
        c.execute('''
        UPDATE restock_events
        SET depleted_timestamp = ?, depleted_datetime_utc = ?, duration_seconds = ?, depletion_rate_per_sec = ?
        WHERE id = ?
        ''', (ts, dt.strftime('%Y-%m-%d %H:%M:%S'), dur, round(rate, 3), event_id))
        conn.commit()
    conn.close()

def update_latest_stock(item_id, item_name, shop_id, shop_name, in_stock, price, ts=None, restock_amount=None):
    if ts is None:
        ts = int(datetime.now(timezone.utc).timestamp())
    dt_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    
    conn = get_connection()
    c = conn.cursor()
    if restock_amount is not None:
        c.execute('''
        INSERT INTO latest_stock (
            item_id, item_name, shop_id, shop_name, in_stock, price,
            last_updated_ts, last_updated_utc, last_restock_ts, last_restock_utc, last_restock_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
            item_name=excluded.item_name, shop_id=excluded.shop_id, shop_name=excluded.shop_name,
            in_stock=excluded.in_stock, price=excluded.price, last_updated_ts=excluded.last_updated_ts,
            last_updated_utc=excluded.last_updated_utc, last_restock_ts=excluded.last_restock_ts,
            last_restock_utc=excluded.last_restock_utc, last_restock_amount=excluded.last_restock_amount
        ''', (item_id, item_name, shop_id, shop_name, in_stock, price, ts, dt_str, ts, dt_str, restock_amount))
    else:
        c.execute('''
        INSERT INTO latest_stock (
            item_id, item_name, shop_id, shop_name, in_stock, price, last_updated_ts, last_updated_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
            item_name=excluded.item_name, shop_id=excluded.shop_id, shop_name=excluded.shop_name,
            in_stock=excluded.in_stock, price=excluded.price, last_updated_ts=excluded.last_updated_ts,
            last_updated_utc=excluded.last_updated_utc
        ''', (item_id, item_name, shop_id, shop_name, in_stock, price, ts, dt_str))
    conn.commit()
    conn.close()

def get_latest_status():
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT * FROM latest_stock ORDER BY item_id ASC')
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def get_recent_events(limit=50):
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
    SELECT * FROM restock_events
    ORDER BY restock_timestamp DESC
    LIMIT ?
    ''', (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def get_item_restock_history(item_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
    SELECT * FROM restock_events
    WHERE item_id = ?
    ORDER BY restock_timestamp ASC
    ''', (item_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows
