// src/components/Settings.jsx
import React from 'react';
import { useUserPreferences } from '../hooks/useUserPreferences';
import './Settings.css';

export default function Settings() {
  const { prefs, loading, updatePrefs } = useUserPreferences();

  if (loading) return <div className="settings-loading">Loading settings…</div>;

  return (
    <div className="settings-container">
      <h2>User Settings</h2>

      <div className="setting-item">
        <label htmlFor="defaultView">Default View:</label>
        <select
          id="defaultView"
          value={prefs.defaultView}
          onChange={(e) => updatePrefs({ defaultView: e.target.value })}
        >
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </div>

      <div className="setting-item">
        <label htmlFor="defaultGroupBy">Default Group By:</label>
        <select
          id="defaultGroupBy"
          value={prefs.defaultGroupBy}
          onChange={(e) => updatePrefs({ defaultGroupBy: e.target.value })}
        >
          <option value="categories">Categories</option>
          <option value="locations">Locations</option>
        </select>
      </div>

      <div className="setting-item">
        <label htmlFor="zoomLevel">Zoom Level:</label>
        <input
          id="zoomLevel"
          type="number"
          min="50"
          max="150"
          step="10"
          value={prefs.preferredZoomLevel}
          onChange={(e) => updatePrefs({ preferredZoomLevel: Number(e.target.value) })}
        />
      </div>

    </div>
  );
}
