// src/components/OffsiteLocationModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './RecurrencePatternModal.css'; // Reuse same modal styling
import './OffsiteLocationModal.css'; // Autocomplete styles

/**
 * OffsiteLocationModal - Modal for entering offsite location details
 * Includes Azure Maps address autocomplete when API key is configured
 */
export default function OffsiteLocationModal({
  isOpen,
  onClose,
  onSave,
  initialName = '',
  initialAddress = '',
  initialLat = null,
  initialLon = null
}) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [lat, setLat] = useState(initialLat);
  const [lon, setLon] = useState(initialLon);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimerRef = useRef(null);
  const wrapperRef = useRef(null);

  // Initialize values when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setAddress(initialAddress);
      setLat(initialLat);
      setLon(initialLon);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [isOpen, initialName, initialAddress, initialLat, initialLon]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced address search using Azure Maps
  const searchAddress = useCallback((query) => {
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Don't search if query is too short
    if (!query || query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Check for API key
    const apiKey = import.meta.env.VITE_AZURE_MAPS_KEY;
    if (!apiKey) {
      // Graceful fallback - no autocomplete without API key
      return;
    }

    // Debounce the search
    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        // Use Fuzzy Search API with typeahead=true for autocomplete
        const response = await fetch(
          `https://atlas.microsoft.com/search/fuzzy/json?` +
          `api-version=1.0&subscription-key=${apiKey}` +
          `&query=${encodeURIComponent(query)}&typeahead=true&limit=5&countrySet=US`
        );

        if (!response.ok) {
          throw new Error('Address search failed');
        }

        const data = await response.json();
        // Map Fuzzy Search results to our format (include coordinates for map display)
        const results = data.results?.map(r => ({
          display: r.address?.freeformAddress || r.poi?.name || '',
          name: r.poi?.name || r.address?.municipality || r.address?.localName || '',
          lat: r.position?.lat || null,
          lon: r.position?.lon || null
        })).filter(r => r.display) || [];

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (err) {
        console.error('Address search failed:', err);
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion) => {
    setAddress(suggestion.display);
    // Store coordinates for map display
    setLat(suggestion.lat);
    setLon(suggestion.lon);
    // Auto-fill name from locality if name is empty
    if (!name && suggestion.name) {
      setName(suggestion.name);
    }
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // Handle address input change
  const handleAddressChange = (e) => {
    const value = e.target.value;
    setAddress(value);
    // Clear coordinates when user types manually (will be set again if they select from suggestions)
    setLat(null);
    setLon(null);
    searchAddress(value);
  };

  const handleSave = () => {
    if (!name.trim() || !address.trim()) {
      alert('Both Offsite Location Name and Address are required');
      return;
    }
    // Pass coordinates along with name and address
    onSave(name.trim(), address.trim(), lat, lon);
    onClose();
  };

  const handleRemove = () => {
    onSave('', '', null, null);
    onClose();
  };

  const handleDiscard = () => {
    setName(initialName);
    setAddress(initialAddress);
    onClose();
  };

  if (!isOpen) return null;

  const hasExistingData = initialName || initialAddress;

  return (
    <div className="recurrence-modal-overlay" onClick={handleDiscard}>
      <div
        className="recurrence-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '500px' }}
      >
        <div className="recurrence-modal-header">
          <h2>Offsite Location</h2>
          <button
            type="button"
            className="recurrence-close-btn"
            onClick={handleDiscard}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="recurrence-modal-body">
          <div style={{ padding: '8px 0' }}>
            {/* Location Name Input */}
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="offsite-name"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151'
                }}
              >
                Location Name *
              </label>
              <input
                id="offsite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Lincoln Center, Central Park"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  outline: 'none'
                }}
                autoFocus
              />
            </div>

            {/* Address Input with Autocomplete */}
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="offsite-address"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151'
                }}
              >
                Address *
              </label>
              <div className="address-autocomplete-wrapper" ref={wrapperRef}>
                <div className="address-input-container">
                  <input
                    id="offsite-address"
                    type="text"
                    value={address}
                    onChange={handleAddressChange}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Start typing an address..."
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      paddingRight: isSearching ? '36px' : '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                    autoComplete="off"
                  />
                  {isSearching && (
                    <span className="address-search-spinner">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" opacity="0.25"/>
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                        </path>
                      </svg>
                    </span>
                  )}
                </div>

                {showSuggestions && suggestions.length > 0 && (
                  <ul className="address-suggestions">
                    {suggestions.map((suggestion, index) => (
                      <li
                        key={index}
                        onClick={() => handleSelectSuggestion(suggestion)}
                        className="address-suggestion-item"
                      >
                        <span className="suggestion-icon">📍</span>
                        <span className="suggestion-text">{suggestion.display}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!import.meta.env.VITE_AZURE_MAPS_KEY && (
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Tip: Configure VITE_AZURE_MAPS_KEY for address suggestions
                </div>
              )}
            </div>

            {/* Preview */}
            {name.trim() && address.trim() && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#fff8f5',
                  borderRadius: '8px',
                  border: '1px solid #FF7043',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <span style={{ fontSize: '24px' }}>📍</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    {address}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="recurrence-modal-footer">
          <button
            type="button"
            className="recurrence-btn recurrence-btn-save"
            onClick={handleSave}
          >
            Save
          </button>
          <button
            type="button"
            className="recurrence-btn recurrence-btn-discard"
            onClick={handleDiscard}
          >
            Cancel
          </button>
          <button
            type="button"
            className="recurrence-btn recurrence-btn-remove"
            onClick={handleRemove}
            disabled={!hasExistingData}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
