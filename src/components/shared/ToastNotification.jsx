/**
 * ToastNotification - Non-blocking notification display component
 * Renders stacked toasts with severity-based styling
 */

import { useNotification } from '../../context/NotificationContext';
import './ToastNotification.css';

// Severity icons (using Unicode symbols for simplicity)
const SEVERITY_ICONS = {
  success: '\u2713', // checkmark
  info: '\u2139',    // info circle
  warning: '\u26A0', // warning triangle
  error: '\u2717',   // X mark
  critical: '\u2757' // exclamation
};

function ToastNotification() {
  const { notifications, removeNotification } = useNotification();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          className={`toast toast-${notification.severity}`}
          style={{ '--toast-index': index }}
          role="alert"
        >
          <span className="toast-icon" aria-hidden="true">
            {SEVERITY_ICONS[notification.severity] || SEVERITY_ICONS.info}
          </span>
          <span className="toast-message">{notification.message}</span>
          <button
            className="toast-dismiss"
            onClick={() => removeNotification(notification.id)}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastNotification;
