import React from 'react';
import MecEventPreview from './MecEventPreview';
import { toMecProps, collectGaps } from '../../utils/mecPreviewMapper';

/**
 * Tab-body wrapper around MecEventPreview. Adds the intro card, the rendered
 * preview (now editable for web override fields), and a side rail summarizing
 * what's still missing.
 *
 * Props:
 *  - event: flat event state (formData) — drives the inputs and the inherited placeholders
 *  - onWebFieldChange: (fieldName, value) => void; fired when an editable input changes.
 *    The form should propagate this up to setFormData and setHasChanges(true).
 */
export default function MecEventPreviewPanel({ event, onWebFieldChange }) {
  const mecProps = toMecProps(event || {});
  const gaps = collectGaps(mecProps);

  return (
    <div className="mec-preview-panel" data-testid="mec-preview-panel">
      <div className="mec-preview-intro">
        <span className="mec-preview-intro-icon" aria-hidden="true">👁️</span>
        <div className="mec-preview-intro-text">
          <strong>Public website editor.</strong> The fields below are how this event will appear
          on emanuelnyc.org. Empty inputs <em>inherit</em> their internal values; type to override
          for the public listing only.
        </div>
      </div>

      <div className="mec-preview-panel-cols">
        <div className="mec-preview-panel-render">
          <MecEventPreview
            mecProps={mecProps}
            formData={event}
            onWebFieldChange={onWebFieldChange}
          />
        </div>
        <GapSummaryRail gaps={gaps} />
      </div>
    </div>
  );
}

function GapSummaryRail({ gaps }) {
  if (!gaps || gaps.length === 0) {
    return (
      <aside className="mec-preview-gap-summary" data-testid="mec-preview-gap-summary">
        <h4 className="mec-preview-gap-summary-title">All set</h4>
        <p className="mec-preview-gap-summary-empty">
          No missing fields. The preview reflects everything the public page would show.
        </p>
      </aside>
    );
  }

  return (
    <aside className="mec-preview-gap-summary" data-testid="mec-preview-gap-summary">
      <h4 className="mec-preview-gap-summary-title">
        {gaps.length} {gaps.length === 1 ? 'issue' : 'issues'} to fix before publishing
      </h4>
      <ul className="mec-preview-gap-list">
        {gaps.map((gap) => (
          <li key={`${gap.label}-${gap.kind}`} className="mec-preview-gap-item">
            <span className="mec-preview-gap-label">{gap.label}</span>
            <span className={`mec-preview-gap-tag mec-preview-gap-tag-${gap.kind}`}>
              {gap.kind === 'no-field' ? 'NO FIELD YET' : 'EMPTY'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mec-preview-gap-legend">
        <strong className="mec-preview-gap-legend-no-field">NO FIELD YET</strong>
        <span> — the app doesn't have this field. Future work.</span>
        <br />
        <strong className="mec-preview-gap-legend-empty">EMPTY</strong>
        <span> — field exists; you can fill it in the </span>
        <strong>Locations</strong>
        <span> tab or another section of the form.</span>
      </p>
    </aside>
  );
}
