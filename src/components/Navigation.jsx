// src/components/Navigation.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';

function Navigation() {
  const location = useLocation();
  
  return (
    <div className="app-header">
      <div className="app-title">
        <h2></h2>
      </div>
      <div className="app-navigation">
        <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
          Calendar
        </Link>
        <Link to="/admin" className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}>
          Admin
        </Link>
      </div>
      <div className="app-status">
        <span className="status-badge">Development</span>
      </div>
    </div>
  );
}

export default Navigation;