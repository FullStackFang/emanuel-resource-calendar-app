// src/components/RecurrencePatternModal.jsx
import React, { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './RecurrencePatternModal.css';
import { logger } from '../utils/logger';
import {
  calculateRecurrenceDates,
  stringsToDates,
  formatRecurrenceSummary
} from '../utils/recurrenceUtils';

/**
 * RecurrencePatternModal - Modal for defining recurring event patterns with calendar preview
 *
 * Supports Outlook-compatible recurrence patterns:
 * - Daily, Weekly, Monthly, Yearly
 * - Custom intervals (every N days/weeks/months/years)
 * - Day of week selection (for weekly)
 * - End date, occurrence count, or never-ending
 * - Visual calendar preview with pattern dates highlighted
 * - Add/exclude specific dates as exceptions
 */
export default function RecurrencePatternModal({
  isOpen,
  onClose,
  onSave,
  initialPattern = null,
  eventStartDate = null,
  existingSeriesDates = [] // Array of YYYY-MM-DD strings for existing events
}) {
  // Recurrence pattern state
  const [frequency, setFrequency] = useState('weekly'); // daily|weekly|monthly|yearly
  const [interval, setInterval] = useState(1);
  const [daysOfWeek, setDaysOfWeek] = useState(['monday']); // For weekly
  const [startDate, setStartDate] = useState(''); // When recurrence starts
  const [endType, setEndType] = useState('endDate'); // endDate|numbered|noEnd
  const [endDate, setEndDate] = useState('');
  const [occurrenceCount, setOccurrenceCount] = useState(10);

  // Calendar preview state
  const [adHocAdditions, setAdHocAdditions] = useState([]);
  const [adHocExclusions, setAdHocExclusions] = useState([]);
  const [viewMonth, setViewMonth] = useState(new Date());

  // Initialize from existing pattern or event start date
  useEffect(() => {
    if (initialPattern) {
      const { pattern, range, additions, exclusions } = initialPattern;

      if (pattern) {
        setFrequency(pattern.type || 'week');
        setInterval(pattern.interval || 1);
        if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
          setDaysOfWeek(pattern.daysOfWeek);
        }
      }

      if (range) {
        setStartDate(range.startDate || eventStartDate || new Date().toISOString().split('T')[0]);
        setEndType(range.type || 'endDate');
        if (range.endDate) {
          setEndDate(range.endDate);
        }
        if (range.numberOfOccurrences) {
          setOccurrenceCount(range.numberOfOccurrences);
        }
      }

      // Load existing additions/exclusions
      if (additions) setAdHocAdditions(additions);
      if (exclusions) setAdHocExclusions(exclusions);
    } else {
      // Reset all state to defaults when no pattern exists
      setFrequency('weekly');
      setInterval(1);
      setEndType('endDate');
      setOccurrenceCount(10);
      setAdHocAdditions([]);
      setAdHocExclusions([]);

      // Set default start date to event start date or today
      const defaultStart = eventStartDate || new Date().toISOString().split('T')[0];
      setStartDate(defaultStart);
      setViewMonth(new Date(defaultStart));

      // Auto-calculate day of week from event start date
      const startDateObj = new Date(defaultStart);
      const dayOfWeekIndex = startDateObj.getDay(); // 0=Sunday, 1=Monday, etc.
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const defaultDay = dayNames[dayOfWeekIndex];
      setDaysOfWeek([defaultDay]);

      // Set default end date to 3 months from start date
      const defaultEnd = new Date(eventStartDate || new Date());
      defaultEnd.setMonth(defaultEnd.getMonth() + 3);
      setEndDate(defaultEnd.toISOString().split('T')[0]);
    }
  }, [initialPattern, eventStartDate, isOpen]);

  // Handle day of week toggle
  const handleDayToggle = (day) => {
    setDaysOfWeek(prev => {
      if (prev.includes(day)) {
        // Don't allow removing the last day
        if (prev.length === 1) return prev;
        return prev.filter(d => d !== day);
      } else {
        return [...prev, day].sort((a, b) => {
          const order = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          return order.indexOf(a) - order.indexOf(b);
        });
      }
    });
  };

  // Handle calendar date click
  const handleCalendarDateClick = (date) => {
    const dateStr = date.toISOString().split('T')[0];

    // Calculate pattern dates for this check
    const currentPatternDates = startDate ? calculateRecurrenceDates(
      { type: frequency, interval, daysOfWeek },
      { startDate, endDate: endType === 'endDate' ? endDate : null, type: endType },
      viewMonth
    ) : [];

    const isPatternDate = currentPatternDates.includes(dateStr);
    const isExcluded = adHocExclusions.includes(dateStr);
    const isAdded = adHocAdditions.includes(dateStr);

    // Smart toggling based on current date state
    if (isExcluded) {
      // Already excluded - un-exclude it
      setAdHocExclusions(prev => prev.filter(d => d !== dateStr));
    } else if (isPatternDate) {
      // Pattern date - clicking should exclude it
      setAdHocExclusions(prev => [...prev, dateStr]);
    } else if (isAdded) {
      // Already added - remove from additions
      setAdHocAdditions(prev => prev.filter(d => d !== dateStr));
    } else {
      // Not in pattern, not added - add it as ad-hoc date
      setAdHocAdditions(prev => [...prev, dateStr]);
    }
  };

  // Remove ad hoc date chip
  const handleRemoveAdHocDate = (dateStr, type) => {
    if (type === 'addition') {
      setAdHocAdditions(prev => prev.filter(d => d !== dateStr));
    } else {
      setAdHocExclusions(prev => prev.filter(d => d !== dateStr));
    }
  };

  // Calculate pattern dates for calendar preview
  const getPatternDates = () => {
    if (!startDate) return [];

    return calculateRecurrenceDates(
      { type: frequency, interval, daysOfWeek },
      { startDate, endDate: endType === 'endDate' ? endDate : null, type: endType },
      viewMonth
    );
  };

  // Save pattern
  const handleSave = () => {
    // Validate and adjust start date for weekly recurrence
    let adjustedStartDate = startDate;
    if (frequency === 'weekly' && daysOfWeek && daysOfWeek.length > 0) {
      const startDateObj = new Date(startDate);
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const startDayOfWeek = dayNames[startDateObj.getDay()];

      // Check if start date's day of week is in the selected days
      if (!daysOfWeek.includes(startDayOfWeek)) {
        // Find the next valid day in the pattern
        // Convert selected days to day indices for comparison
        const selectedDayIndices = daysOfWeek.map(day => dayNames.indexOf(day)).sort((a, b) => a - b);
        const currentDayIndex = startDateObj.getDay();

        // Find the next day that matches the pattern
        let nextDayIndex = selectedDayIndices.find(idx => idx > currentDayIndex);
        if (nextDayIndex === undefined) {
          // Wrap to next week
          nextDayIndex = selectedDayIndices[0] + 7;
        }

        const daysToAdd = nextDayIndex - currentDayIndex;
        const adjustedDate = new Date(startDateObj);
        adjustedDate.setDate(adjustedDate.getDate() + daysToAdd);
        adjustedStartDate = adjustedDate.toISOString().split('T')[0];

        logger.debug('Adjusted start date to match recurrence pattern:', {
          originalStartDate: startDate,
          adjustedStartDate,
          selectedDays: daysOfWeek,
          reason: `Start date was ${startDayOfWeek}, but pattern requires ${daysOfWeek.join(', ')}`
        });
      }
    }

    // Build recurrence pattern object
    const pattern = {
      type: frequency,
      interval: parseInt(interval),
      daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
      firstDayOfWeek: 'sunday'
    };

    const range = {
      type: endType,
      startDate: adjustedStartDate,
      endDate: endType === 'endDate' ? endDate : undefined,
      numberOfOccurrences: endType === 'numbered' ? parseInt(occurrenceCount) : undefined
    };

    // Calculate ALL pattern dates (not just current month view)
    const allPatternDates = startDate ? calculateRecurrenceDates(
      pattern,
      range,
      new Date(startDate) // Use start date as base
    ) : [];

    // Clean up: Remove ad-hoc additions that are now covered by the pattern
    const cleanedAdditions = adHocAdditions.filter(dateStr => !allPatternDates.includes(dateStr));

    // Clean up: Remove exclusions that are no longer in the pattern
    const cleanedExclusions = adHocExclusions.filter(dateStr => allPatternDates.includes(dateStr));

    logger.debug('Recurrence pattern saved:', {
      pattern,
      range,
      additions: cleanedAdditions,
      exclusions: cleanedExclusions,
      removed: {
        additionsNowInPattern: adHocAdditions.filter(d => !cleanedAdditions.includes(d)),
        exclusionsNoLongerInPattern: adHocExclusions.filter(d => !cleanedExclusions.includes(d))
      }
    });

    onSave({
      pattern,
      range,
      additions: cleanedAdditions,
      exclusions: cleanedExclusions
    });
    onClose();
  };

  // Discard changes and close
  const handleDiscard = () => {
    onClose();
  };

  // Remove recurrence
  const handleRemove = () => {
    onSave(null);
    onClose();
  };

  if (!isOpen) return null;

  // Day of week options
  const daysOptions = [
    { value: 'sunday', label: 'Sun' },
    { value: 'monday', label: 'Mon' },
    { value: 'tuesday', label: 'Tue' },
    { value: 'wednesday', label: 'Wed' },
    { value: 'thursday', label: 'Thu' },
    { value: 'friday', label: 'Fri' },
    { value: 'saturday', label: 'Sat' }
  ];

  // Get pattern dates for calendar highlighting
  const patternDates = getPatternDates();

  return (
    <div className="recurrence-modal-overlay" onClick={handleDiscard}>
      <div className="recurrence-modal" onClick={(e) => e.stopPropagation()}>
        <div className="recurrence-modal-header">
          <h2>Repeat</h2>
          <button
            type="button"
            className="recurrence-close-btn"
            onClick={handleDiscard}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="recurrence-modal-body">
          <div className="recurrence-modal-columns">
            {/* Left Column - Calendar Preview */}
            <div className="recurrence-calendar-column">
              {/* Calendar */}
              <DatePicker
                inline
                selected={null}
                onChange={handleCalendarDateClick}
                onMonthChange={setViewMonth}
                dayClassName={(date) => {
                  const dateStr = date.toISOString().split('T')[0];
                  if (adHocExclusions.includes(dateStr)) return 'adhoc-exclusion';
                  if (adHocAdditions.includes(dateStr)) return 'adhoc-addition';
                  if (patternDates.includes(dateStr)) return 'recurrence-pattern';
                  if (existingSeriesDates.includes(dateStr)) return 'existing-event';
                  return '';
                }}
              />

              {/* Legend */}
              <div className="calendar-legend">
                <div className="legend-item">
                  <div className="legend-color recurrence-pattern-color"></div>
                  <span>Pattern dates</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color adhoc-addition-color"></div>
                  <span>Added dates</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color adhoc-exclusion-color"></div>
                  <span>Excluded dates</span>
                </div>
                {existingSeriesDates.length > 0 && (
                  <div className="legend-item">
                    <div className="legend-color existing-event-color"></div>
                    <span>Existing events</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Configuration */}
            <div className="recurrence-config-column">
              {/* Start Date */}
              <div className="recurrence-start-row">
                <label>Start</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="recurrence-start-date-input"
                />
              </div>

              {/* Frequency and Interval */}
              <div className="recurrence-repeat-row">
                <span className="repeat-icon">↻</span>
                <label>Repeat every</label>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  className="recurrence-interval-input"
                />
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="recurrence-frequency-select"
                >
                  <option value="daily">day{interval > 1 ? 's' : ''}</option>
                  <option value="weekly">week{interval > 1 ? 's' : ''}</option>
                  <option value="monthly">month{interval > 1 ? 's' : ''}</option>
                  <option value="yearly">year{interval > 1 ? 's' : ''}</option>
                </select>
              </div>

              {/* Days of Week (for weekly recurrence) */}
              {frequency === 'weekly' && (
                <div className="recurrence-days-section">
                  <div className="recurrence-days-grid">
                    {daysOptions.map(day => (
                      <button
                        key={day.value}
                        type="button"
                        className={`recurrence-day-circle ${daysOfWeek.includes(day.value) ? 'selected' : ''}`}
                        onClick={() => handleDayToggle(day.value)}
                      >
                        {day.label.charAt(0)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary Text */}
              <div className="recurrence-summary-text">
                {formatRecurrenceSummary(
                  { type: frequency, interval, daysOfWeek },
                  { type: endType, startDate, endDate, numberOfOccurrences: occurrenceCount }
                )}
              </div>

              {/* End Date Picker */}
              {endType === 'endDate' && (
                <div className="recurrence-end-date-picker">
                  <label>End date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="recurrence-end-date-input"
                    min={startDate}
                  />
                  <button
                    type="button"
                    className="recurrence-remove-end-btn"
                    onClick={() => setEndType('noEnd')}
                  >
                    Remove end date
                  </button>
                </div>
              )}

              {/* Add End Date Link */}
              {endType === 'noEnd' && (
                <div className="recurrence-add-end-wrapper">
                  <button
                    type="button"
                    className="recurrence-add-end"
                    onClick={() => setEndType('endDate')}
                  >
                    Add end date
                  </button>
                </div>
              )}

              {/* Ad Hoc Dates Section - Two columns */}
              {(adHocAdditions.length > 0 || adHocExclusions.length > 0) && (
                <div className="adhoc-dates-section">
                  <div className="adhoc-dates-columns">
                    {adHocAdditions.length > 0 && (
                      <div className="adhoc-dates-group">
                        <h4>Ad-hoc Dates:</h4>
                        <div className="adhoc-dates-grid">
                          {adHocAdditions.map(dateStr => (
                            <div key={dateStr} className="adhoc-date-chip addition">
                              <span>{new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric'
                              })}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveAdHocDate(dateStr, 'addition')}
                                aria-label="Remove"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {adHocExclusions.length > 0 && (
                      <div className="adhoc-dates-group">
                        <h4>Excluded Dates:</h4>
                        <div className="adhoc-dates-grid">
                          {adHocExclusions.map(dateStr => (
                            <div key={dateStr} className="adhoc-date-chip exclusion">
                              <span>{new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric'
                              })}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveAdHocDate(dateStr, 'exclusion')}
                                aria-label="Remove"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
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
            Discard
          </button>
          <button
            type="button"
            className="recurrence-btn recurrence-btn-remove"
            onClick={handleRemove}
            disabled={!initialPattern}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
