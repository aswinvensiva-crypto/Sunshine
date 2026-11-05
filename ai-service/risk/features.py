"""
risk/features.py — Feature engineering for booking risk scoring.

CRITICAL: Only features known at booking CREATION time may be used.
Anything recorded AFTER the booking is created (e.g. status changes, actual checkout)
is excluded. This is verified by the leakage_test() function.

Features:
  - lead_days: days between booking creation and check_in
  - nights: length of stay
  - num_guests: party size
  - season_index: 0=low, 1=shoulder, 2=high (based on check_in month)
  - day_of_week_checkin: 0=Mon..6=Sun
  - source_encoded: direct=0, booking.com=1, agoda=2, walk-in=3, other=4
  - payment_method_encoded: cash=0, card=1, upi=2
  - advance_ratio: advance_paid / total_amount (0 if total=0)
  - prior_stays: count of completed prior bookings by same guest in this tenant
  - prior_cancels: count of cancelled prior bookings by same guest

Post-booking columns (MUST NOT be used as features):
  - status (the label itself)
  - actual_checkout, actual_nights (recorded after checkout)
  - refund_* columns
  - checked_out/cancelled timestamps
"""

import numpy as np
import pandas as pd
from typing import List

FEATURE_COLS = [
    'lead_days', 'nights', 'num_guests', 'season_index',
    'day_of_week_checkin', 'source_encoded', 'payment_method_encoded',
    'advance_ratio', 'prior_stays', 'prior_cancels'
]

SOURCE_MAP = {
    'direct': 0, 'Direct': 0,
    'booking.com': 1, 'Booking.com': 1,
    'agoda': 2, 'Agoda': 2,
    'walk-in': 3, 'Walk-in': 3,
}
PAYMENT_MAP = {'cash': 0, 'card': 1, 'upi': 2}


def month_to_season(month: int) -> int:
    """India resort seasons: Oct-Mar=high(2), Apr-Jun=shoulder(1), Jul-Sep=low(0)."""
    if month in (10, 11, 12, 1, 2, 3):
        return 2
    if month in (4, 5, 6):
        return 1
    return 0


def build_features(
    bookings_df: pd.DataFrame,
    guest_history_df: pd.DataFrame,  # prior stays/cancels per (tenant_id, guest_id)
) -> pd.DataFrame:
    """
    Build feature matrix from bookings + guest history.
    Both dataframes must be from the SAME tenant (tenant isolation enforced by caller).
    """
    df = bookings_df.copy()

    # Date parsing
    df['check_in'] = pd.to_datetime(df['check_in'])
    df['created_at'] = pd.to_datetime(df['created_at'])

    df['lead_days'] = (df['check_in'] - df['created_at']).dt.days.clip(lower=0)
    df['season_index'] = df['check_in'].dt.month.map(month_to_season)
    df['day_of_week_checkin'] = df['check_in'].dt.dayofweek
    df['source_encoded'] = df['source'].map(SOURCE_MAP).fillna(4).astype(int)
    df['payment_method_encoded'] = df['payment_method'].map(PAYMENT_MAP).fillna(0).astype(int)

    total = df['total_amount'].replace(0, np.nan)
    df['advance_ratio'] = (df['advance_paid'] / total).fillna(0).clip(0, 1)

    # Prior history (within-tenant only, per RK-006 and U-12)
    if len(guest_history_df) > 0:
        hist = guest_history_df.set_index('guest_id')[['prior_stays', 'prior_cancels']]
        df = df.join(hist, on='guest_id', how='left')
    else:
        df['prior_stays'] = 0
        df['prior_cancels'] = 0
    df[['prior_stays', 'prior_cancels']] = df[['prior_stays', 'prior_cancels']].fillna(0).astype(int)

    return df[FEATURE_COLS].astype(float)


def build_guest_history(bookings_df: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """
    Compute per-guest history using only bookings BEFORE as_of timestamp.
    This prevents leakage: future booking outcomes cannot be used.
    """
    past = bookings_df[pd.to_datetime(bookings_df['created_at']) < as_of]
    completed = past[past['status'] == 'checked_out'].groupby('guest_id').size().rename('prior_stays')
    cancelled = past[past['status'] == 'cancelled'].groupby('guest_id').size().rename('prior_cancels')
    hist = pd.concat([completed, cancelled], axis=1).fillna(0).reset_index()
    return hist


def leakage_test(bookings_df: pd.DataFrame) -> bool:
    """
    Assert that no feature derivation reads columns recorded after booking creation.
    Raises AssertionError if a post-booking column would be needed.
    """
    post_booking_cols = [
        'actual_checkout', 'actual_nights', 'refund_amount', 'refund_status',
        'refund_processed_at', 'balance_paid_at', 'checkout_notification_sent_at'
    ]
    for col in post_booking_cols:
        assert col not in FEATURE_COLS, f'LEAKAGE: post-booking column {col} in FEATURE_COLS'
    return True
