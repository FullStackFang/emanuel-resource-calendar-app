// src/components/RoleSimulator.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useRoleSimulation, ROLE_TEMPLATES } from '../context/RoleSimulationContext';
import './RoleSimulator.css';

/**
 * Dropdown component for admins to simulate different user roles.
 * Only visible to actual admins when not already simulating.
 */
export function RoleSimulator() {
  const { isActualAdmin, isSimulating, startSimulation, simulatedRole } = useRoleSimulation();
  const [expanded, setExpanded] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setExpanded(false);
      }
    }

    if (expanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expanded]);

  // Don't show if not an admin or already simulating (use banner to exit)
  if (!isActualAdmin || isSimulating) {
    return null;
  }

  const handleRoleSelect = (roleKey) => {
    startSimulation(roleKey);
    setExpanded(false);
  };

  // Filter out admin role from simulation options (no point simulating admin)
  const simulatableRoles = Object.entries(ROLE_TEMPLATES).filter(
    ([key]) => key !== 'admin'
  );

  return (
    <div className="role-simulator" ref={dropdownRef}>
      <button
        className="role-simulator-toggle"
        onClick={() => setExpanded(!expanded)}
        title="Simulate viewing as different user role"
      >
        <span className="role-simulator-icon">&#128100;</span>
        View As...
        <span className={`dropdown-arrow ${expanded ? 'expanded' : ''}`}>▼</span>
      </button>

      {expanded && (
        <ul className="role-simulator-dropdown">
          <li className="role-simulator-header">
            Simulate User Role
          </li>
          {simulatableRoles.map(([key, role]) => (
            <li key={key}>
              <button
                className={`role-simulator-option ${simulatedRole === key ? 'active' : ''}`}
                onClick={() => handleRoleSelect(key)}
              >
                <span className="role-name">{role.name}</span>
                <span className="role-description">{role.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RoleSimulator;
