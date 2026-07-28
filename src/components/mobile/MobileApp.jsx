import React, { useState } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import MobileHeader from './MobileHeader';
import MobileBottomTabs from './MobileBottomTabs';
import MobileAgenda from './MobileAgenda';
import MobileRequests from './MobileRequests';
import './MobileApp.css';

function MobileApp() {
  const [activeTab, setActiveTab] = useState('calendar');
  const { canApproveReservations } = usePermissions();

  const renderActiveView = () => {
    switch (activeTab) {
      case 'calendar':
        return <MobileAgenda />;
      case 'my-events':
        return <MobileRequests />;
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
      <MobileBottomTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        permissions={{ canApproveReservations }}
      />
    </div>
  );
}

export default MobileApp;
