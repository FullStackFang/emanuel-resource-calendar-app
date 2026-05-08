import React from 'react';
import { isMissing } from '../../utils/mecPreviewMapper';
import './mecEventPreview.css';

function formatDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return isoDate;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[parseInt(m[2], 10) - 1];
  const day = parseInt(m[3], 10);
  const year = m[1];
  return `${month} ${day}, ${year}`;
}

function formatTime(time24) {
  if (!time24 || typeof time24 !== 'string') return time24;
  const m = time24.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return time24;
  const hours = parseInt(m[1], 10);
  const minutes = m[2];
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${minutes} ${ampm}`;
}

function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

function EmptyBadge({ children }) {
  return <span className="mec-preview-empty-badge">{children}</span>;
}

function noop() {}

/**
 * Featured image block — editable URL input + rendered hero.
 * When the URL is valid, the hero shows an <img>; when empty/invalid, the
 * striped placeholder appears.
 */
function FeaturedImageBlock({ imageUrl, formData, onChange }) {
  const url = formData?.webFeaturedImage || '';
  const showImage = isValidUrl(url);

  return (
    <div className="mec-preview-hero-wrap">
      {showImage ? (
        <div className="mec-preview-hero" data-testid="mec-preview-featured-image">
          <img className="mec-preview-hero-image" src={url} alt="" />
        </div>
      ) : (
        <div
          className="mec-preview-hero mec-preview-hero-empty"
          role="img"
          aria-label="Featured image not set"
          data-testid="mec-preview-featured-empty"
        >
          <span className="mec-preview-hero-empty-text">Featured image not set</span>
        </div>
      )}
      <input
        type="url"
        className="mec-preview-image-url-input"
        value={url}
        onChange={(e) => onChange('webFeaturedImage', e.target.value)}
        placeholder="Paste a featured image URL — e.g. https://..."
        aria-label="Featured image URL"
        data-testid="mec-preview-featured-input"
      />
    </div>
  );
}

/**
 * Editable title — input styled to look like the public-page <h1>.
 * When empty, placeholder shows the inherited eventTitle; when filled,
 * the input value IS the displayed title.
 */
function TitleBlock({ formData, onChange }) {
  const inheritedTitle = formData?.eventTitle || '';
  const value = formData?.webTitle || '';
  return (
    <input
      type="text"
      className={`mec-preview-title-input ${value ? '' : 'mec-preview-title-input--empty'}`}
      value={value}
      onChange={(e) => onChange('webTitle', e.target.value)}
      placeholder={inheritedTitle || 'Title not set'}
      aria-label="Public page title (overrides internal title when set)"
      data-testid="mec-preview-title-input"
    />
  );
}

/**
 * Editable description — textarea styled like the public-page body copy.
 */
function ContentBlock({ formData, onChange }) {
  const inheritedDescription = formData?.eventDescription || '';
  const value = formData?.webDescription || '';
  return (
    <textarea
      className={`mec-preview-content-input ${value ? '' : 'mec-preview-content-input--empty'}`}
      value={value}
      onChange={(e) => onChange('webDescription', e.target.value)}
      placeholder={inheritedDescription || 'Description not set'}
      aria-label="Public page description (overrides internal description when set)"
      data-testid="mec-preview-content-input"
      rows={6}
    />
  );
}

/**
 * Editable register URL — URL input + a styled Register button when valid.
 */
function RegisterButtonBlock({ formData, onChange }) {
  const url = formData?.webRegisterUrl || '';
  const hasUrl = isValidUrl(url);

  return (
    <div className="mec-preview-register-wrap">
      {hasUrl ? (
        <a
          className="mec-preview-register"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="mec-preview-register-button"
        >
          Register
        </a>
      ) : (
        <span
          className="mec-preview-register mec-preview-register-empty"
          data-testid="mec-preview-register-empty"
        >
          <span className="mec-preview-warn-icon" aria-hidden="true">⚠</span>
          Register URL not set
        </span>
      )}
      <input
        type="url"
        className="mec-preview-register-url-input"
        value={url}
        onChange={(e) => onChange('webRegisterUrl', e.target.value)}
        placeholder="Paste a registration link — e.g. https://..."
        aria-label="Public page Register button URL"
        data-testid="mec-preview-register-input"
      />
    </div>
  );
}

function MetaRow({ icon, label, children, testId }) {
  return (
    <div className="mec-preview-meta-row" data-testid={testId}>
      <span className="mec-preview-meta-icon" aria-hidden="true">{icon}</span>
      <div className="mec-preview-meta-cell">
        <div className="mec-preview-meta-label">{label}</div>
        <div className="mec-preview-meta-value">{children}</div>
      </div>
    </div>
  );
}

/**
 * Read-only meta box: date, time, location, category. These are scheduled
 * facts driven by the event itself — not overridable in v1.
 */
function MetaBox({ startDate, startTime, locationName, locationAddress, categoryName, isRecurring }) {
  return (
    <div className="mec-preview-meta">
      <MetaRow icon="📅" label="Date" testId="mec-preview-meta-date">
        {isMissing(startDate)
          ? <EmptyBadge>DATE NOT SET</EmptyBadge>
          : (
            <>
              {formatDate(startDate)}
              {isRecurring && (
                <span
                  className="mec-preview-recurring-badge"
                  data-testid="mec-preview-recurring-badge"
                >
                  RECURRING
                </span>
              )}
            </>
          )}
      </MetaRow>

      <MetaRow icon="⏰" label="Time" testId="mec-preview-meta-time">
        {isMissing(startTime)
          ? <EmptyBadge>TIME NOT SET</EmptyBadge>
          : formatTime(startTime)}
      </MetaRow>

      <MetaRow icon="📍" label="Location" testId="mec-preview-meta-location">
        {isMissing(locationName) ? (
          <EmptyBadge>LOCATION NOT SET</EmptyBadge>
        ) : (
          <>
            <div>{locationName}</div>
            {isMissing(locationAddress)
              ? <EmptyBadge>ADDRESS NOT SET</EmptyBadge>
              : <div className="mec-preview-meta-secondary">{locationAddress}</div>
            }
          </>
        )}
      </MetaRow>

      <MetaRow icon="📁" label="Category" testId="mec-preview-meta-category">
        {isMissing(categoryName)
          ? <EmptyBadge>CATEGORY NOT SET</EmptyBadge>
          : categoryName}
      </MetaRow>
    </div>
  );
}

function ShareRow() {
  return (
    <div className="mec-preview-share">
      <h3 className="mec-preview-share-title">Share this event</h3>
      <div className="mec-preview-share-icons" aria-hidden="true">
        <span className="mec-preview-share-icon">f</span>
        <span className="mec-preview-share-icon">𝕏</span>
        <span className="mec-preview-share-icon">in</span>
        <span className="mec-preview-share-icon">@</span>
      </div>
    </div>
  );
}

/**
 * MEC + Elementor public-page preview, with the editable web override surface.
 *
 * Props:
 *  - mecProps: resolved props from mecPreviewMapper.toMecProps (drives read-only meta)
 *  - formData: flat event state (drives the web* inputs and inherited placeholders)
 *  - onWebFieldChange: (fieldName, value) => void; called when an editable input changes
 */
export default function MecEventPreview({ mecProps, formData = {}, onWebFieldChange = noop }) {
  if (!mecProps) return null;
  const isRecurring = mecProps.eventType === 'seriesMaster';

  return (
    <div className="mec-preview-root" data-testid="mec-preview-root">
      <FeaturedImageBlock imageUrl={mecProps.featuredImageUrl} formData={formData} onChange={onWebFieldChange} />
      <div className="mec-preview-cols">
        <div className="mec-preview-main">
          <TitleBlock formData={formData} onChange={onWebFieldChange} />
          <ContentBlock formData={formData} onChange={onWebFieldChange} />
          <RegisterButtonBlock formData={formData} onChange={onWebFieldChange} />
        </div>
        <div className="mec-preview-side">
          <MetaBox
            startDate={mecProps.startDate}
            startTime={mecProps.startTime}
            locationName={mecProps.locationName}
            locationAddress={mecProps.locationAddress}
            categoryName={mecProps.categoryName}
            isRecurring={isRecurring}
          />
          <ShareRow />
        </div>
      </div>
    </div>
  );
}
