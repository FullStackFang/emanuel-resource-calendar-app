// src/components/LocationMultiSelect.jsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './LocationMultiSelect.css';

function LocationMultiSelect({
  rooms,
  availability,
  selectedRooms,
  onRoomSelectionChange,
  checkRoomCapacity,
  label = "Select Locations",
  eventStartTime,
  eventEndTime,
  eventDate
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  // Pre-compute conflict results for all rooms (avoids per-room recalculation during render)
  const roomConflictMap = useMemo(() => {
    const map = new Map();
    if (!eventStartTime || !eventEndTime || !eventDate) {
      return map;
    }
    const userStart = new Date(`${eventDate}T${eventStartTime}`);
    const userEnd = new Date(`${eventDate}T${eventEndTime}`);

    rooms.forEach(room => {
      const roomAvailability = availability.find(a => a.room._id === room._id);
      if (!roomAvailability) {
        map.set(room._id, { hasConflicts: false, conflictCount: 0 });
        return;
      }

      let conflictCount = 0;
      if (roomAvailability.conflicts?.reservations) {
        roomAvailability.conflicts.reservations.forEach(res => {
          const resStart = new Date(res.effectiveStart);
          const resEnd = new Date(res.effectiveEnd);
          if (userStart < resEnd && userEnd > resStart) conflictCount++;
        });
      }
      if (roomAvailability.conflicts?.events) {
        roomAvailability.conflicts.events.forEach(evt => {
          const evtStart = new Date(evt.start);
          const evtEnd = new Date(evt.end);
          if (userStart < evtEnd && userEnd > evtStart) conflictCount++;
        });
      }
      map.set(room._id, { hasConflicts: conflictCount > 0, conflictCount });
    });
    return map;
  }, [rooms, availability, eventStartTime, eventEndTime, eventDate]);

  const checkRoomConflicts = useCallback((room) => {
    return roomConflictMap.get(room._id) || { hasConflicts: false, conflictCount: 0 };
  }, [roomConflictMap]);

  // Filter rooms based on search term (memoized)
  const filteredRooms = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    if (!lowerSearch) return rooms;
    return rooms.filter(room =>
      room.name.toLowerCase().includes(lowerSearch) ||
      room.building?.toLowerCase().includes(lowerSearch) ||
      room.features?.some(feature => feature.toLowerCase().includes(lowerSearch))
    );
  }, [rooms, searchTerm]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const toggleRoom = useCallback((room) => {
    const newSelected = selectedRooms.includes(room._id)
      ? selectedRooms.filter(id => id !== room._id)
      : [...selectedRooms, room._id];
    onRoomSelectionChange(newSelected);
  }, [selectedRooms, onRoomSelectionChange]);

  const selectAllAvailable = useCallback(() => {
    const availableRooms = rooms.filter(room => {
      const { hasConflicts } = checkRoomConflicts(room);
      const { meetsCapacity } = checkRoomCapacity(room);
      return !hasConflicts && meetsCapacity;
    });

    onRoomSelectionChange(availableRooms.map(room => room._id));
  }, [rooms, checkRoomConflicts, checkRoomCapacity, onRoomSelectionChange]);

  const clearAll = useCallback(() => {
    onRoomSelectionChange([]);
  }, [onRoomSelectionChange]);

  const getRoomStatus = useCallback((room) => {
    const { hasConflicts } = checkRoomConflicts(room);
    const { meetsCapacity } = checkRoomCapacity(room);

    if (hasConflicts) {
      return { status: 'busy', color: '#dc2626', icon: '⚠️', text: 'Conflicts' };
    } else if (!meetsCapacity) {
      return { status: 'capacity', color: '#f59e0b', icon: '⚠️', text: 'Capacity' };
    } else {
      return { status: 'available', color: '#16a34a', icon: '✓', text: 'Available' };
    }
  }, [checkRoomConflicts, checkRoomCapacity]);

  const getFeatureIcons = useCallback((features) => {
    const iconMap = {
      'Kitchen': '🍽️',
      'AV Equipment': '📺',
      'Projector': '📽️',
      'Whiteboard': '📝',
      'Conference Phone': '📞',
      'Parking': '🚗',
      'Wheelchair Accessible': '♿',
      'Piano': '🎹',
      'Sound System': '🔊',
      'Stage': '🎭',
      'Tables': '📋',
      'Chairs': '💺'
    };

    return features?.slice(0, 4).map(feature => iconMap[feature] || '•').join(' ') || '';
  }, []);

  return (
    <div ref={dropdownRef} className="location-multiselect">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="location-multiselect-trigger"
      >
        <div className="trigger-content">
          <span className="trigger-text">
            {selectedRooms.length === 0
              ? label
              : selectedRooms.length === 1
                ? rooms.find(r => r._id === selectedRooms[0])?.name || '1 location selected'
                : `${selectedRooms.length} locations selected`
            }
          </span>
          <div className="trigger-indicators">
            {selectedRooms.length > 0 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                className="clear-button"
                title="Clear all selections"
                role="button"
                tabIndex={0}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    clearAll();
                  }
                }}
              >
                ×
              </span>
            )}
            <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="location-multiselect-dropdown">
          {/* Search Header */}
          <div className="dropdown-header">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search locations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="action-buttons">
              <button type="button" onClick={selectAllAvailable} className="action-btn">
                All Available
              </button>
              <button type="button" onClick={clearAll} className="action-btn">
                Clear
              </button>
            </div>
          </div>

          {/* Room List */}
          <div className="rooms-list">
            {filteredRooms.length === 0 ? (
              <div className="no-results">
                {searchTerm ? `No locations match "${searchTerm}"` : 'No locations available'}
              </div>
            ) : (
              filteredRooms.map(room => {
                const roomStatus = getRoomStatus(room);
                const isSelected = selectedRooms.includes(room._id);

                return (
                  <div 
                    key={room._id} 
                    className={`room-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleRoom(room)}
                  >
                    <div className="room-main-info">
                      <div className="room-primary">
                        <div className="room-name-line">
                          <h4 className="room-name">{room.name}</h4>
                          <span 
                            className="room-status"
                            style={{ color: roomStatus.color }}
                            title={roomStatus.text}
                          >
                            {roomStatus.icon}
                          </span>
                        </div>
                        <div className="room-details">
                          <span className="room-location">
                            {room.building} - {room.floor}
                          </span>
                          <span className="room-capacity">
                            👥 {room.capacity}
                          </span>
                          {room.features && room.features.length > 0 && (
                            <span className="room-features-icons">
                              {getFeatureIcons(room.features)}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="room-actions">
                        <label className="selection-option">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRoom(room)}
                          />
                          <span className="checkbox-label">Select</span>
                        </label>
                      </div>
                    </div>

                    {room.description && (
                      <div className="room-description">{room.description}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Selected Summary */}
          {selectedRooms.length > 0 && (
            <div className="selection-summary">
              <div className="summary-item">
                <strong>{selectedRooms.length}</strong> location{selectedRooms.length !== 1 ? 's' : ''} selected
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(LocationMultiSelect);