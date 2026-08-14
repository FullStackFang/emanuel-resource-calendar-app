import React, { useState } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../context/AuthContext';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { recordVisit } from '../../utils/pwaInstall';
import MobileHeader from './MobileHeader';
import MobileBottomTabs from './MobileBottomTabs';
import MobileCalendarTab from './MobileCalendarTab';
import MobileRequests from './MobileRequests';
import InstallAppNudge from './InstallAppNudge';
import InstallAppSheet from './InstallAppSheet';
import './MobileApp.css';

function MobileApp() {
  const [activeTab, setActiveTab] = useState('calendar');
  const { canApproveReservations } = usePermissions();

  // Install affordance (design D9): this component is its single owner. Two
  // triggers — the menu entry and the nudge — resolve to one action, and this
  // is the only place that decides what that action is. Nothing upstream of
  // here knows about platform.
  const { isAvailable, canPrompt, platform, promptInstall } = usePwaInstall();
  const [installSheetOpen, setInstallSheetOpen] = useState(false);

  // Count this signed-in session during render, not in an effect: the nudge is
  // a child, and child effects run BEFORE the parent's, so an effect here would
  // hand the nudge last session's count and delay it by one visit. recordVisit
  // is idempotent per browsing session (sessionStorage guard), so running it
  // from a state initializer — twice under StrictMode — is safe.
  //
  // MobileApp only mounts when App.jsx has an apiToken, but the predicate takes
  // isAuthenticated explicitly rather than relying on that structural fact.
  const { apiToken } = useAuth();
  const isAuthenticated = Boolean(apiToken);
  const [visitCount] = useState(() => (isAuthenticated ? recordVisit() : 0));

  // Where the browser can really install, install — no sheet of ours in the
  // way (revises design D3, which routed every platform through the sheet for
  // symmetry). promptInstall() must be called synchronously here: an await
  // before it would void the user gesture and the browser's dialog would
  // silently never appear.
  //
  // The branch is `canPrompt`, not a user-agent test, so a browser that can
  // install gets the dialog whatever its UA claims. Everything else — iOS, and
  // any browser that withheld beforeinstallprompt — gets the instructions. The
  // captured event is single-use, so a dismissed dialog naturally lands here
  // on the next tap with platform 'manual'.
  const handleInstall = () => {
    if (canPrompt) {
      promptInstall();
      return;
    }
    setInstallSheetOpen(true);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'calendar':
        return <MobileCalendarTab />;
      case 'my-events':
        return <MobileRequests />;
      default:
        return null;
    }
  };

  return (
    <div className="mobile-app">
      <MobileHeader showInstall={isAvailable} onInstall={handleInstall} />
      <div className="mobile-app-content">
        {renderActiveView()}
      </div>
      <MobileBottomTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        permissions={{ canApproveReservations }}
      />
      <InstallAppNudge
        isAvailable={isAvailable}
        isAuthenticated={isAuthenticated}
        visitCount={visitCount}
        onInstall={handleInstall}
      />
      <InstallAppSheet
        isOpen={installSheetOpen}
        platform={platform}
        onClose={() => setInstallSheetOpen(false)}
        promptInstall={promptInstall}
      />
    </div>
  );
}

export default MobileApp;
