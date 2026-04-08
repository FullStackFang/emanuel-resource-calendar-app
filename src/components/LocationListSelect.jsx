// src/components/LocationListSelect.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './LocationListSelect.css';

const ITEMS_PER_PAGE = 8;

function LocationListSelect({
  rooms,
  availability,
  selectedRooms,
  onRoomSelectionChange,
  checkRoomCapacity,
  label = "Select Locations",
  eventStartTime,
  eventEndTime,
  eventDate,
  // Offsite location props
  isOffsite = false,
  offsiteName = '',
  onOffsiteToggle,
  // Read-only mode
  disabled = false
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(0);

  // Helper function to normalize IDs for comparison (handles ObjectId vs string mismatch)
  const normalizeId = useCallback((id) => id?.toString() || id, []);

  // Check if a room is selected using normalized comparison
  const isRoomSelected = useCallback((roomId) => {
    const normalizedRoomId = normalizeId(roomId);
    return selectedRooms.some(selectedId => normalizeId(selectedId) === normalizedRoomId);
  }, [selectedRooms, normalizeId]);

  // Pre-compute conflict results for all rooms (avoids per-room recalculation during render)
  const roomConflictMap = useMemo(() => {
    const map = new Map();
    if (!eventStartTime || !eventEndTime || !eventDate) {
      return map;
    }
    const userStart = new Date(`${eventDate}T${eventStartTime}`);
    const userEnd = new Date(`${eventDate}T${eventEndTime}`);

    rooms.forEach(room => {
      const roomAvailability = availability.find(a => normalizeId(a.room._id) === normalizeId(room._id));
      if (!roomAvailability) {
        map.set(normalizeId(room._id), { hasConflicts: false, conflictCount: 0 });
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
      map.set(normalizeId(room._id), { hasConflicts: conflictCount > 0, conflictCount });
    });
    return map;
  }, [rooms, availability, eventStartTime, eventEndTime, eventDate, normalizeId]);

  const checkRoomConflicts = useCallback((room) => {
    return roomConflictMap.get(normalizeId(room._id)) || { hasConflicts: false, conflictCount: 0 };
  }, [roomConflictMap, normalizeId]);

  // Memoize all derived room lists to avoid O(n) work on every render
  const { paginatedRooms, combinedRooms, totalPages } = useMemo(() => {
    // Get full room objects for selected IDs
    const selectedRoomsData = rooms.filter(room =>
      selectedRooms.some(id => normalizeId(id) === normalizeId(room._id))
    );

    // Filter rooms based on search term
    const lowerSearch = searchTerm.toLowerCase();
    const filteredRooms = lowerSearch
      ? rooms.filter(room =>
          room.name.toLowerCase().includes(lowerSearch) ||
          room.building?.toLowerCase().includes(lowerSearch) ||
          room.features?.some(feature => feature.toLowerCase().includes(lowerSearch))
        )
      : rooms;

    // Get unselected rooms from filtered results
    const unselectedRooms = filteredRooms.filter(room =>
      !selectedRooms.some(id => normalizeId(id) === normalizeId(room._id))
    );

    // Combine: selected first (always shown), then unselected
    const combined = [...selectedRoomsData, ...unselectedRooms];

    // Calculate pagination
    const pages = Math.ceil(combined.length / ITEMS_PER_PAGE);
    const startIndex = currentPage * ITEMS_PER_PAGE;
    const paginated = combined.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    return { paginatedRooms: paginated, combinedRooms: combined, totalPages: pages };
  }, [rooms, selectedRooms, searchTerm, currentPage, normalizeId]);

  // Reset to first page when search changes or when current page is out of bounds
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    } else if (totalPages === 0) {
      setCurrentPage(0);
    }
  }, [searchTerm, totalPages, currentPage]);

  // Reset to first page when search term changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm]);

  const toggleRoom = useCallback((room) => {
    const roomId = normalizeId(room._id);
    const isCurrentlySelected = selectedRooms.some(id => normalizeId(id) === roomId);

    const newSelected = isCurrentlySelected
      ? selectedRooms.filter(id => normalizeId(id) !== roomId)
      : [...selectedRooms, room._id];
    onRoomSelectionChange(newSelected);
  }, [selectedRooms, normalizeId, onRoomSelectionChange]);

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
    <div className="location-list-select">
      {/* Header with Search and Actions */}
      <div className="list-header">
        <h3 className="list-title">{label}</h3>
        <input
          type="text"
          placeholder="Search locations..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="list-search-input"
          disabled={disabled || isOffsite}
        />
        <div className="list-action-buttons">
          {onOffsiteToggle && (
            <button
              type="button"
              onClick={onOffsiteToggle}
              className={`list-action-btn offsite-btn ${isOffsite ? 'active' : ''}`}
              title={isOffsite ? `Edit offsite location: ${offsiteName}` : 'Set off-site location'}
              disabled={disabled}
            >
              {isOffsite ? '📍 Edit Offsite' : '📍 Offsite'}
            </button>
          )}
          <button type="button" onClick={clearAll} className="list-action-btn" disabled={disabled || isOffsite}>
            Clear All
          </button>
        </div>
      </div>

      {/* Pagination Tabs - only show if more than one page */}
      {totalPages > 1 && !isOffsite && (
        <div className="list-pagination-tabs">
          {Array.from({ length: totalPages }, (_, index) => (
            <button
              key={index}
              type="button"
              className={`list-page-tab ${currentPage === index ? 'active' : ''}`}
              onClick={() => setCurrentPage(index)}
              disabled={disabled}
            >
              {index + 1}
            </button>
          ))}
          <span className="list-page-info">
            {combinedRooms.length} locations
          </span>
        </div>
      )}

      {/* Room List */}
      <div className={`list-rooms-container ${disabled || isOffsite ? 'disabled' : ''}`}>
        {isOffsite ? (
          <div className="list-offsite-message">
            <span className="offsite-message-icon">📍</span>
            <span className="offsite-message-text">Using offsite location</span>
          </div>
        ) : paginatedRooms.length === 0 ? (
          <div className="list-no-results">
            {searchTerm ? `No locations match "${searchTerm}"` : 'No locations available'}
          </div>
        ) : (
          paginatedRooms.map(room => {
            const isSelected = isRoomSelected(room._id);
            return (
              <div
                key={room._id}
                className={`list-room-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && toggleRoom(room)}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onKeyPress={(e) => {
                  if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                    toggleRoom(room);
                  }
                }}
                aria-disabled={disabled}
              >
                <div className="list-room-header">
                  <h4 className="list-room-name">{room.name}</h4>
                </div>
                <div className="list-room-details">
                  <span className="list-room-location">
                    🏢 {room.building} {room.floor && `- ${room.floor}`}
                  </span>
                  <span className="list-room-capacity">
                    👥 {room.capacity}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selection Summary */}
      {selectedRooms.length > 0 && (
        <div className="list-selection-summary">
          <strong>{selectedRooms.length}</strong> location{selectedRooms.length !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}

export default React.memo(LocationListSelect);
