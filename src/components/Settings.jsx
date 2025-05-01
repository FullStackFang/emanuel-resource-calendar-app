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
        <label htmlFor="startOfWeek">Start of Week:</label>
        <select
          id="startOfWeek"
          value={prefs.startOfWeek}
          onChange={(e) => updatePrefs({ startOfWeek: e.target.value })}
        >
          <option value="Sunday">Sunday</option>
          <option value="Monday">Monday</option>
        </select>
      </div>
      
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
        <label htmlFor="defaultGroupBy">Default Group By:!</label>
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
      
      <h3>Event Permissions</h3>
      
      <div className="setting-item checkbox-item">
        <label htmlFor="createEvents">
          <input
            id="createEvents"
            type="checkbox"
            checked={prefs.createEvents}
            onChange={(e) => updatePrefs({ createEvents: e.target.checked })}
          />
          Allow Creating Events
        </label>
      </div>
      
      <div className="setting-item checkbox-item">
        <label htmlFor="editEvents">
          <input
            id="editEvents"
            type="checkbox"
            checked={prefs.editEvents}
            onChange={(e) => updatePrefs({ editEvents: e.target.checked })}
          />
          Allow Editing Events
        </label>
      </div>
      
      <div className="setting-item checkbox-item">
        <label htmlFor="deleteEvents">
          <input
            id="deleteEvents"
            type="checkbox"
            checked={prefs.deleteEvents}
            onChange={(e) => updatePrefs({ deleteEvents: e.target.checked })}
          />
          Allow Deleting Events
        </label>
      </div>
    </div>
  );
}