// src/components/AppHeader.jsx
import React from 'react';
import { useRoleSimulationSafe } from '../context/RoleSimulationContext';
import Authentication from './Authentication';

export default function AppHeader({ onSignIn, onSignOut }) {
  const { isSimulating } = useRoleSimulationSafe();

  return (
    <header className={`app-header ${isSimulating ? 'simulating' : ''}`}>
      <h1 className="app-title">Temple Events Scheduler</h1>
      <Authentication onSignIn={onSignIn} onSignOut={onSignOut} />
    </header>
  );
}
