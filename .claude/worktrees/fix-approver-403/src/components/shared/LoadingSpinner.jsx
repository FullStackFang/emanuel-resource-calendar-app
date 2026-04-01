import './LoadingSpinner.css';

/**
 * Standardized loading spinner for the entire application.
 *
 * Variants:
 *   'default'  – spinner centered in a flex container (for sections/panels)
 *   'card'     – spinner inside an elevated card (for page-level & modal content gates)
 *   'overlay'  – absolute backdrop with blur + card (for navigation/transition overlays)
 *
 * className modifiers: 'fullscreen', 'inline', 'compact'
 */
const LoadingSpinner = ({
  size = 48,
  minHeight = 200,
  className = '',
  text = '',
  variant = 'default'
}) => {
  const spinner = (
    <div
      className="loading-spinner-css"
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(3, size / 16)
      }}
    />
  );

  // Overlay variant: absolute backdrop with spinner centered directly (no card)
  if (variant === 'overlay') {
    return (
      <div className={`loading-spinner-overlay ${className}`}>
        {spinner}
        {text && <p className="loading-spinner-card-text">{text}</p>}
      </div>
    );
  }

  // Card variant: spinner inside elevated card
  if (variant === 'card') {
    return (
      <div className={`loading-spinner-container ${className}`} style={{ minHeight }}>
        <div className="loading-spinner-card">
          {spinner}
          {text && <p className="loading-spinner-card-text">{text}</p>}
        </div>
      </div>
    );
  }

  // Default variant: spinner centered in container
  return (
    <div className={`loading-spinner-container ${className}`} style={{ minHeight }}>
      {spinner}
      {text && <span className="loading-spinner-text">{text}</span>}
    </div>
  );
};

export default LoadingSpinner;
