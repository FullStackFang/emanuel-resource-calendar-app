import './LoadingSpinner.css';

const LoadingSpinner = ({ size = 64, minHeight = 300, className = '' }) => (
  <div className={`loading-spinner-container ${className}`} style={{ minHeight }}>
    <div
      className="loading-spinner-css"
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(3, size / 16)
      }}
    />
  </div>
);

export default LoadingSpinner;
