import React from 'react';
import './MobileBottomTabs.css';

// Tab `id` is a wire identifier, not a label. `my-events` feeds
// `?view=my-events`, `keys.events.list({ view: 'my-events' })` and the existing
// test suites — relabeling the tab must never rename it.
//
// `requires` names a key of the `permissions` prop. Tabs without it are always
// shown; gated tabs (the Approvals tab, when it lands) drop out of the bar
// entirely and the survivors reflow to equal widths, matching how the desktop
// nav hides the Approval Queue link.
const TABS = [
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'my-events',
    label: 'Requests',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      </svg>
    ),
  },
];

function MobileBottomTabs({ activeTab, onTabChange, permissions = {} }) {
  const visibleTabs = TABS.filter(tab => !tab.requires || !!permissions[tab.requires]);

  return (
    <nav className="mobile-bottom-tabs" aria-label="Main navigation">
      {visibleTabs.map(tab => (
        <button
          key={tab.id}
          className={`mobile-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <span className="mobile-tab-icon">{tab.icon}</span>
          <span className="mobile-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default MobileBottomTabs;
