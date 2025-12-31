import { RotatingLines } from 'react-loader-spinner';
import './LoadingSpinner.css';

const LoadingSpinner = ({ size = 64, minHeight = 300 }) => (
  <div className="loading-spinner-container" style={{ minHeight }}>
    <RotatingLines
      strokeColor="#007bff"
      strokeWidth="5"
      animationDuration="0.75"
      width={size.toString()}
      visible={true}
    />
  </div>
);

export default LoadingSpinner;
