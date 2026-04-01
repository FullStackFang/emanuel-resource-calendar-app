import React, { useState, useEffect, useCallback } from 'react';
import './FreshnessIndicator.css';

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function FreshnessIndicator({ lastFetchedAt, onRefresh, isRefreshing }) {
  const [relativeTime, setRelativeTime] = useState('');

  const updateTime = useCallback(() => {
    setRelativeTime(formatRelativeTime(lastFetchedAt));
  }, [lastFetchedAt]);

  useEffect(() => {
    updateTime();
    const interval = setInterval(updateTime, 10_000);
    return () => clearInterval(interval);
  }, [updateTime]);

  if (!lastFetchedAt) return null;

  return (
    <span className="freshness-indicator">
      <span className="freshness-text">Updated {relativeTime}</span>
      <button
        className={`freshness-refresh-btn${isRefreshing ? ' refreshing' : ''}`}
        onClick={onRefresh}
        disabled={isRefreshing}
        title="Refresh now"
        aria-label="Refresh data"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </span>
  );
}
