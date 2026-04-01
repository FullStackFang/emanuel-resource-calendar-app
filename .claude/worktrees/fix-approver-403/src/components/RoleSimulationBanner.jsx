// src/components/RoleSimulationBanner.jsx
import React from 'react';
import { useRoleSimulation } from '../context/RoleSimulationContext';
import './RoleSimulationBanner.css';

/**
 * Banner displayed at the top of the app when role simulation is active.
 * Shows which role is being simulated and provides an exit button.
 */
export function RoleSimulationBanner() {
  const { isSimulating, simulatedRoleName, endSimulation } = useRoleSimulation();

  if (!isSimulating) {
    return null;
  }

  return (
    <div className="role-simulation-banner">
      <div className="role-simulation-banner-content">
        <span className="role-simulation-icon">&#128100;</span>
        <span className="role-simulation-text">
          Viewing as: <strong>{simulatedRoleName}</strong>
        </span>
        <span className="role-simulation-note">
          (UI testing mode - data created is still yours)
        </span>
      </div>
      <button
        className="role-simulation-exit-button"
        onClick={endSimulation}
        title="Exit role simulation and return to admin view"
      >
        Exit Simulation
      </button>
    </div>
  );
}

export default RoleSimulationBanner;
