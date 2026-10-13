import math
from datetime import datetime, timezone
from .database import get_item_restock_history, get_latest_status, get_connection

def calculate_item_predictions(item_id):
    history = get_item_restock_history(item_id)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    
    if not history:
        return {
            'item_id': item_id,
            'sample_count': 0,
            'status': 'insufficient_data',
            'message': 'No restock events recorded yet for this item.'
        }

    # Extract restock intervals
    intervals = []
    depletions = []
    minute_distribution = {}
    
    for i in range(len(history)):
        ev = history[i]
        r_min = ev['restock_minute']
        minute_distribution[r_min] = minute_distribution.get(r_min, 0) + 1
        
        if ev['duration_seconds'] and ev['duration_seconds'] > 0:
            depletions.append(ev['duration_seconds'])
            
        if i > 0:
            dt_diff = ev['restock_timestamp'] - history[i-1]['restock_timestamp']
            if dt_diff > 30: # Ignore duplicate multi-triggers
                intervals.append(dt_diff)

    sample_count = len(history)
    latest_event = history[-1]
    last_restock_ts = latest_event['restock_timestamp']
    elapsed_seconds = now_ts - last_restock_ts

    # Basic statistics
    if intervals:
        avg_interval = sum(intervals) / len(intervals)
        variance = sum((x - avg_interval) ** 2 for x in intervals) / len(intervals)
        std_dev = math.sqrt(variance)
        min_interval = min(intervals)
        max_interval = max(intervals)
    else:
        # Prior default expectation for Torn City shops: ~15 minutes (900 seconds)
        avg_interval = 900.0
        std_dev = 120.0
        min_interval = 600.0
        max_interval = 1200.0

    # Depletion statistics
    if depletions:
        avg_depletion_time = sum(depletions) / len(depletions)
    else:
        avg_depletion_time = 180.0 # Default ~3 minutes to sell out

    # Predictive ETA
    predicted_next_ts = int(last_restock_ts + avg_interval)
    eta_seconds = max(0, predicted_next_ts - now_ts)
    is_overdue = now_ts > predicted_next_ts

    # Probability estimation: CDF of normal distribution approximation
    if std_dev > 0:
        z_score = (elapsed_seconds - avg_interval) / std_dev
        # Approximation of standard normal CDF
        prob_restocked_by_now = 0.5 * (1.0 + math.erf(z_score / math.sqrt(2.0)))
    else:
        prob_restocked_by_now = 1.0 if elapsed_seconds >= avg_interval else 0.0

    # Peak minutes: which minutes past the hour restocks happened most frequently
    sorted_minutes = sorted(minute_distribution.items(), key=lambda x: x[1], reverse=True)
    peak_minutes = [f":{m:02d}" for m, c in sorted_minutes[:4]]

    return {
        'item_id': item_id,
        'item_name': latest_event['item_name'],
        'shop_name': latest_event['shop_name'],
        'sample_count': sample_count,
        'last_restock_ts': last_restock_ts,
        'last_restock_utc': latest_event['restock_datetime_utc'],
        'elapsed_seconds': elapsed_seconds,
        'avg_interval_seconds': round(avg_interval, 1),
        'avg_interval_minutes': round(avg_interval / 60.0, 2),
        'std_dev_seconds': round(std_dev, 1),
        'min_interval_seconds': round(min_interval, 1),
        'max_interval_seconds': round(max_interval, 1),
        'avg_depletion_seconds': round(avg_depletion_time, 1),
        'predicted_next_ts': predicted_next_ts,
        'eta_seconds': eta_seconds,
        'eta_formatted': f"{int(eta_seconds // 60)}m {int(eta_seconds % 60)}s" if not is_overdue else "Imminent / Overdue",
        'is_overdue': is_overdue,
        'probability_by_now': round(min(0.999, max(0.001, prob_restocked_by_now)), 3),
        'peak_restock_minutes': peak_minutes,
        'minute_histogram': minute_distribution
    }

def get_all_predictions(tracked_item_ids):
    results = {}
    for iid in tracked_item_ids:
        results[str(iid)] = calculate_item_predictions(int(iid))
    return results
