// src/components/Authentication.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../config/authConfig';
import { useRoleSimulationSafe, ROLE_TEMPLATES } from '../context/RoleSimulationContext';

function Authentication({ onSignIn, onSignOut }) {
  const { instance, accounts } = useMsal();
  // Use safe version - returns defaults when outside RoleSimulationProvider
  const { isActualAdmin, isSimulating, simulatedRoleName, startSimulation, endSimulation } = useRoleSimulationSafe();
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setRoleDropdownOpen(false);
      }
    }

    if (roleDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [roleDropdownOpen]);

  const handleLogin = async () => {
    try {
      const loginResponse = await instance.loginPopup(loginRequest);
      const account = loginResponse.account;
      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account
      });
      if (onSignIn) onSignIn(tokenResponse.accessToken);
    } catch (error) {
      console.error('Microsoft login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await instance.logoutPopup();
    } catch (error) {
      console.error('Microsoft logout failed:', error);
    }
    if (onSignOut) onSignOut();
  };

  const handleRoleSelect = (roleKey) => {
    startSimulation(roleKey);
    setRoleDropdownOpen(false);
  };

  const handleExitSimulation = () => {
    endSimulation();
    setRoleDropdownOpen(false);
  };

  const toggleRoleDropdown = () => {
    if (isActualAdmin) {
      setRoleDropdownOpen(!roleDropdownOpen);
    }
  };

  // Get username display - show simulated role if simulating
  const getUsernameDisplay = () => {
    if (isSimulating && simulatedRoleName) {
      return `${accounts[0].username} (as ${simulatedRoleName})`;
    }
    return accounts[0].username;
  };

  return (
    <div className="authentication-container">
      {accounts.length === 0 ? (
        <button onClick={handleLogin} className="login-button">
          Sign in with Microsoft
        </button>
      ) : (
        <div className="authenticated-user" ref={dropdownRef}>
          <span
            onClick={toggleRoleDropdown}
            className={`username-display ${isActualAdmin ? 'admin-clickable' : ''} ${isSimulating ? 'simulating' : ''}`}
            title={isActualAdmin ? 'Click to view as different role' : undefined}
          >
            {getUsernameDisplay()}
            {isActualAdmin && (
              <span className={`role-dropdown-arrow ${roleDropdownOpen ? 'expanded' : ''}`}>
                ▼
              </span>
            )}
          </span>

          {/* Role Simulation Dropdown */}
          {roleDropdownOpen && isActualAdmin && (
            <div className="role-dropdown-menu">
              <div className="role-dropdown-header">View As...</div>
              {Object.entries(ROLE_TEMPLATES).map(([key, role]) => (
                <button
                  key={key}
                  className="role-dropdown-item"
                  onClick={() => handleRoleSelect(key)}
                >
                  <span className="role-name">{role.name}</span>
                  <span className="role-description">{role.description}</span>
                </button>
              ))}
              {isSimulating && (
                <>
                  <div className="role-dropdown-divider" />
                  <button
                    className="role-dropdown-item exit-simulation"
                    onClick={handleExitSimulation}
                  >
                    Exit Simulation
                  </button>
                </>
              )}
            </div>
          )}

          <button onClick={handleLogout} className="logout-button">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

export default Authentication;
