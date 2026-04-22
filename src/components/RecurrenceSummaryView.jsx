// src/components/RecurrenceSummaryView.jsx
import { formatCompactDate, formatRecurrenceSummaryCompact } from '../utils/recurrenceUtils';
import { RecurringIcon } from './shared/CalendarIcons';
import './RecurrenceSummaryView.css';

/**
 * Read-only summary for a recurrence pattern. Replaces the grayed-out editor
 * that used to render when the user could not edit — disabled inputs invite
 * clicks that silently reject, which is worse than a clear sentence.
 */
function ExceptionDateList({ title, dates }) {
  if (!dates || dates.length === 0) return null;
  return (
    <section>
      <span className="recurrence-summary-exceptions-label">
        {title} ({dates.length})
      </span>
      <ul>
        {dates.map((d) => (
          <li key={d}>{formatCompactDate(d) || d}</li>
        ))}
      </ul>
    </section>
  );
}

export default function RecurrenceSummaryView({ recurrencePattern }) {
  const hasPattern = Boolean(recurrencePattern?.pattern && recurrencePattern?.range);

  if (!hasPattern) {
    return (
      <div className="recurrence-summary recurrence-summary--empty">
        <RecurringIcon size={28} className="recurrence-summary-icon" />
        <p>This event does not have a recurrence pattern.</p>
      </div>
    );
  }

  const { pattern, range, additions = [], exclusions = [] } = recurrencePattern;
  const summary = formatRecurrenceSummaryCompact(pattern, range, additions, exclusions);

  return (
    <div className="recurrence-summary">
      <div className="recurrence-summary-header">
        <RecurringIcon size={20} className="recurrence-summary-icon" />
        <p className="recurrence-summary-text">{summary}</p>
      </div>
      {(additions.length > 0 || exclusions.length > 0) && (
        <div className="recurrence-summary-exceptions">
          <ExceptionDateList title="Added dates" dates={additions} />
          <ExceptionDateList title="Excluded dates" dates={exclusions} />
        </div>
      )}
    </div>
  );
}
