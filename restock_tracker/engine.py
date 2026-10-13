import time
import json
import os
import urllib.request
from datetime import datetime, timezone

from .database import (
    init_db, record_snapshot, record_restock_event,
    mark_depleted, update_latest_stock
)
from .notify import trigger_alert

CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

class RestockEngine:
    def __init__(self, config_path=CONFIG_FILE):
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)

        self.api_keys = self.config.get('api_keys', [])
        self.key_index = 0
        self.running = False
        self.previous_stock = {} # { item_id: int }
        self.previous_price = {} # { item_id: int }
        self.tracked_items = self.config.get('tracked_items', {})
        self.min_restock_amount = self.config.get('alerts', {}).get('min_restock_amount', 50)
        self.base_interval = self.config.get('polling', {}).get('base_interval_seconds', 20)
        self.fast_interval = self.config.get('polling', {}).get('fast_interval_seconds', 6)
        self.fast_window_minutes = set(self.config.get('polling', {}).get('fast_window_minutes', [0, 15, 30, 45]))
        self.fast_buffer = self.config.get('polling', {}).get('fast_window_buffer_seconds', 90)

    def get_active_key(self):
        if not self.api_keys:
            return None
        return self.api_keys[self.key_index % len(self.api_keys)]

    def rotate_key(self):
        if len(self.api_keys) > 1:
            self.key_index = (self.key_index + 1) % len(self.api_keys)
            print(f"[Engine] Rotated to API key #{self.key_index + 1}")

    def fetch_city_shops(self):
        key = self.get_active_key()
        if not key:
            print("[Engine Error] No API key configured!")
            return None

        url = f"https://api.torn.com/torn/?selections=cityshops&key={key}"
        req = urllib.request.Request(url, headers={'User-Agent': 'TornCityRestockTracker/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                data = json.loads(resp.read().decode())
                if 'error' in data:
                    print(f"[Engine API Error] {data['error'].get('error', 'Unknown error')}")
                    self.rotate_key()
                    return None
                return data.get('cityshops', {})
        except Exception as e:
            print(f"[Engine Network Error] {e}")
            self.rotate_key()
            return None

    def determine_sleep_time(self):
        now_utc = datetime.now(timezone.utc)
        minute = now_utc.minute
        second = now_utc.second

        # Check if we are inside or approaching a restock window (e.g. :00, :15, :30, :45)
        # Fast window covers from 1 minute prior to 1.5 minutes after each quarter-hour
        is_fast_window = False
        for target_min in self.fast_window_minutes:
            diff_min = (minute - target_min) % 60
            if diff_min == 0 or diff_min == 1:
                is_fast_window = True
                break
            elif diff_min == 59 and second >= 40:
                is_fast_window = True
                break

        return self.fast_interval if is_fast_window else self.base_interval

    def process_cycle(self):
        shops = self.fetch_city_shops()
        if not shops:
            return

        now_ts = int(datetime.now(timezone.utc).timestamp())
        current_seen_items = set()

        for sid_str, shop in shops.items():
            shop_id = int(sid_str)
            shop_name = shop.get('name', f'Shop {shop_id}')
            inventory = shop.get('inventory', {})

            for iid_str, item in inventory.items():
                item_id = int(iid_str)
                item_name = item.get('name', f'Item {item_id}')
                current_stock = int(item.get('in_stock', 0))
                price = item.get('price')
                current_seen_items.add(item_id)

                prev_stock = self.previous_stock.get(item_id, None)
                delta = 0 if prev_stock is None else (current_stock - prev_stock)

                # Check for Restock Event
                if prev_stock is not None:
                    # Case A: Restocked from 0 to positive
                    # Case B: Significant restock addition
                    if (prev_stock == 0 and current_stock > 0) or (delta >= self.min_restock_amount):
                        record_restock_event(
                            item_id=item_id, item_name=item_name, shop_id=shop_id,
                            shop_name=shop_name, prev_stock=prev_stock, new_stock=current_stock,
                            added=delta if delta > 0 else current_stock, ts=now_ts
                        )
                        update_latest_stock(
                            item_id=item_id, item_name=item_name, shop_id=shop_id,
                            shop_name=shop_name, in_stock=current_stock, price=price,
                            ts=now_ts, restock_amount=current_stock
                        )
                        # Trigger alerts if this item is tracked
                        tracked_info = self.tracked_items.get(str(item_id))
                        if tracked_info and tracked_info.get('alert_enabled', True):
                            trigger_alert(item_name, shop_name, current_stock, price)

                    elif delta != 0:
                        update_latest_stock(
                            item_id=item_id, item_name=item_name, shop_id=shop_id,
                            shop_name=shop_name, in_stock=current_stock, price=price, ts=now_ts
                        )
                else:
                    # Initial seed
                    update_latest_stock(
                        item_id=item_id, item_name=item_name, shop_id=shop_id,
                        shop_name=shop_name, in_stock=current_stock, price=price, ts=now_ts
                    )

                # Record time-series snapshot
                record_snapshot(
                    shop_id=shop_id, shop_name=shop_name, item_id=item_id,
                    item_name=item_name, in_stock=current_stock, price=price,
                    delta=delta, ts=now_ts
                )

                self.previous_stock[item_id] = current_stock
                self.previous_price[item_id] = price

        # Check for items that disappeared from inventory (stock hit 0)
        # Any item previously known with stock > 0 that is missing in current_seen_items is now out of stock
        for prev_id, p_stock in list(self.previous_stock.items()):
            if prev_id not in current_seen_items and p_stock > 0:
                # Stock depleted to 0
                mark_depleted(prev_id, ts=now_ts)
                delta = -p_stock
                record_snapshot(
                    shop_id=0, shop_name="Unknown", item_id=prev_id,
                    item_name=f"Item {prev_id}", in_stock=0, price=self.previous_price.get(prev_id),
                    delta=delta, ts=now_ts
                )
                self.previous_stock[prev_id] = 0

    def start(self):
        init_db()
        self.running = True
        print("==========================================================")
        print("[+] Torn City Shop Restock Tracker Engine Started")
        print(f"[*] Tracking priority items: {', '.join([v['name'] for v in self.tracked_items.values()])}")
        print("==========================================================")

        while self.running:
            try:
                self.process_cycle()
            except Exception as e:
                print(f"[Engine Exception] {e}")

            sleep_duration = self.determine_sleep_time()
            time.sleep(sleep_duration)

    def stop(self):
        self.running = False
        print("[Engine] Stopped.")
