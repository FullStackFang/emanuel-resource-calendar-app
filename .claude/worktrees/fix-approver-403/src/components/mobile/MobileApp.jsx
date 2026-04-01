import React, { useState } from 'react';
import MobileHeader from './MobileHeader';
import MobileBottomTabs from './MobileBottomTabs';
import MobileAgenda from './MobileAgenda';
import './MobileApp.css';

function MobileApp() {
  const [activeTab, setActiveTab] = useState('calendar');

  const renderActiveView = () => {
    switch (activeTab) {
      case 'calendar':
        return <MobileAgenda />;
      case 'my-events':
        return (
          <div className="mobile-placeholder-tab">
            <div className="mobile-placeholder-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
            </div>
            <span className="mobile-placeholder-title">My Events</span>
            <span className="mobile-placeholder-desc">Coming soon</span>
          </div>
        );
      case 'chat':
        return (
          <div className="mobile-placeholder-tab">
            <div className="mobile-placeholder-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="mobile-placeholder-title">Chat Assistant</span>
            <span className="mobile-placeholder-desc">Coming soon</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mobile-app">
      <MobileHeader />
      <div className="mobile-app-content">
        {renderActiveView()}
      </div>
      <MobileBottomTabs activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

export default MobileApp;
