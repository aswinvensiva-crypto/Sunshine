"""
splitters.py — Time-ordered data splitters for ML evaluation.
NO random shuffling across time — avoids temporal leakage.
"""
from typing import Generator, Tuple
import numpy as np
import pandas as pd


def time_ordered_split(
    df: pd.DataFrame,
    date_col: str,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    # test is remainder
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split dataframe by time. Returns (train, val, test) in chronological order."""
    df_sorted = df.sort_values(date_col)
    n = len(df_sorted)
    train_end = int(n * train_ratio)
    val_end = int(n * (train_ratio + val_ratio))
    return df_sorted.iloc[:train_end], df_sorted.iloc[train_end:val_end], df_sorted.iloc[val_end:]


def rolling_origin_splits(
    df: pd.DataFrame,
    date_col: str,
    min_train_days: int = 90,
    horizon_days: int = 60,
    step_days: int = 30,
) -> Generator[Tuple[pd.DataFrame, pd.DataFrame], None, None]:
    """Generator yielding (train_df, test_df) for rolling-origin backtesting."""
    if df.empty:
        return
    df_sorted = df.sort_values(date_col)
    dates = pd.to_datetime(df_sorted[date_col])
    min_date = dates.min()
    max_date = dates.max()
    if pd.isna(min_date) or pd.isna(max_date):
        return
    cutoff = min_date + pd.Timedelta(days=min_train_days)
    while cutoff + pd.Timedelta(days=horizon_days) <= max_date:
        train = df_sorted[dates < cutoff]
        test = df_sorted[(dates >= cutoff) & (dates < cutoff + pd.Timedelta(days=horizon_days))]
        if len(train) > 0 and len(test) > 0:
            yield train, test
        cutoff += pd.Timedelta(days=step_days)
