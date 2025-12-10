// src/components/LocationListSelect.jsx
import React, { useState } from 'react';
import './LocationListSelect.css';

export default function LocationListSelect({
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
  onOffsiteToggle
}) {
  const [searchTerm, setSearchTerm] = useState('');

  // Helper function to normalize IDs for comparison (handles ObjectId vs string mismatch)
  const normalizeId = (id) => id?.toString() || id;

  // Check if a room is selected using normalized comparison
  const isRoomSelected = (roomId) => {
    const normalizedRoomId = normalizeId(roomId);
    return selectedRooms.some(selectedId => normalizeId(selectedId) === normalizedRoomId);
  };

  // Helper function to check if two time ranges overlap
  const checkTimeOverlap = (start1, end1, start2, end2) => {
    return start1 < end2 && end1 > start2;
  };

  // Dynamically calculate if a room has conflicts based on current event time
  const checkRoomConflicts = (room) => {
    // If no event time is set, can't determine conflicts
    if (!eventStartTime || !eventEndTime || !eventDate) {
      return { hasConflicts: false, conflictCount: 0 };
    }

    const roomAvailability = availability.find(a => normalizeId(a.room._id) === normalizeId(room._id));
    if (!roomAvailability) {
      return { hasConflicts: false, conflictCount: 0 };
    }

    // Parse user's event times
    const userStart = new Date(`${eventDate}T${eventStartTime}`);
    const userEnd = new Date(`${eventDate}T${eventEndTime}`);

    let conflictCount = 0;

    // Check reservation conflicts
    if (roomAvailability.conflicts?.reservations) {
      roomAvailability.conflicts.reservations.forEach(res => {
        const resStart = new Date(res.effectiveStart);
        const resEnd = new Date(res.effectiveEnd);
        if (checkTimeOverlap(userStart, userEnd, resStart, resEnd)) {
          conflictCount++;
        }
      });
    }

    // Check calendar event conflicts
    if (roomAvailability.conflicts?.events) {
      roomAvailability.conflicts.events.forEach(evt => {
        const evtStart = new Date(evt.start);
        const evtEnd = new Date(evt.end);
        if (checkTimeOverlap(userStart, userEnd, evtStart, evtEnd)) {
          conflictCount++;
        }
      });
    }

    return { hasConflicts: conflictCount > 0, conflictCount };
  };

  // Filter rooms based on search term
  const filteredRooms = rooms.filter(room =>
    room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    room.building?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    room.features?.some(feature => feature.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleRoom = (room) => {
    const roomId = normalizeId(room._id);
    const isCurrentlySelected = selectedRooms.some(id => normalizeId(id) === roomId);

    const newSelected = isCurrentlySelected
      ? selectedRooms.filter(id => normalizeId(id) !== roomId)
      : [...selectedRooms, room._id];
    onRoomSelectionChange(newSelected);
  };

  const clearAll = () => {
    onRoomSelectionChange([]);
  };

  const getRoomStatus = (room) => {
    const { hasConflicts } = checkRoomConflicts(room);
    const { meetsCapacity } = checkRoomCapacity(room);

    if (hasConflicts) {
      return { status: 'busy', color: '#dc2626', icon: '⚠️', text: 'Conflicts' };
    } else if (!meetsCapacity) {
      return { status: 'capacity', color: '#f59e0b', icon: '⚠️', text: 'Capacity' };
    } else {
      return { status: 'available', color: '#16a34a', icon: '✓', text: 'Available' };
    }
  };

  const getFeatureIcons = (features) => {
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
  };

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
          disabled={isOffsite}
        />
        <div className="list-action-buttons">
          {onOffsiteToggle && (
            <button
              type="button"
              onClick={onOffsiteToggle}
              className={`list-action-btn offsite-btn ${isOffsite ? 'active' : ''}`}
              title={isOffsite ? `Edit offsite location: ${offsiteName}` : 'Set off-site location'}
            >
              {isOffsite ? '📍 Edit Offsite' : '📍 Offsite'}
            </button>
          )}
          <button type="button" onClick={clearAll} className="list-action-btn" disabled={isOffsite}>
            Clear All
          </button>
        </div>
      </div>

      {/* Scrollable Room List */}
      <div className={`list-rooms-container ${isOffsite ? 'disabled' : ''}`}>
        {isOffsite ? (
          <div className="list-offsite-message">
            <span className="offsite-message-icon">📍</span>
            <span className="offsite-message-text">Using offsite location</span>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="list-no-results">
            {searchTerm ? `No locations match "${searchTerm}"` : 'No locations available'}
          </div>
        ) : (
          filteredRooms.map(room => {
            const roomStatus = getRoomStatus(room);
            const isSelected = isRoomSelected(room._id);

            return (
              <div
                key={room._id}
                className={`list-room-card ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleRoom(room)}
                role="button"
                tabIndex={0}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    toggleRoom(room);
                  }
                }}
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
