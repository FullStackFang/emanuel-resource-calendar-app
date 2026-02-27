/**
 * Inline SVG icon components for calendar views.
 * Replaces emoji characters with consistent, scalable vector icons.
 *
 * Design: 16x16 viewBox, 1.5px stroke, round caps/joins, currentColor inheritance.
 */

const svgProps = (size, className) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.5',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: `cal-icon ${className}`,
});

export const PencilIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
  </svg>
);

export const RecurringIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
    <polyline points="12 1 12 4.5 8.5 4.5" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
    <polyline points="4 15 4 11.5 7.5 11.5" />
  </svg>
);

export const WarningIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)} fill="currentColor" strokeWidth="0">
    <path d="M8.87 1.52a1 1 0 0 0-1.74 0L.88 13a1 1 0 0 0 .87 1.5h12.5a1 1 0 0 0 .87-1.5L8.87 1.52z" />
    <line x1="8" y1="6" x2="8" y2="9.5" stroke="white" strokeWidth="1.5" />
    <circle cx="8" cy="11.5" r="0.75" fill="white" stroke="none" />
  </svg>
);

export const ConcurrentIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <path d="M1 8h4l2-3 2 6 2-3h4" />
  </svg>
);

export const TimerIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="8" cy="9" r="5.5" />
    <line x1="8" y1="9" x2="8" y2="6" />
    <line x1="8" y1="9" x2="10.5" y2="9" />
    <line x1="6" y1="2" x2="10" y2="2" />
    <line x1="8" y1="2" x2="8" y2="3.5" />
  </svg>
);

export const LocationIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <path d="M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 0 1 8 1.5z" />
    <circle cx="8" cy="6" r="1.5" />
  </svg>
);

export const VideoIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <rect x="1" y="4" width="9" height="8" rx="1" />
    <path d="M10 7l4-2v6l-4-2" />
  </svg>
);

export const TagIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <path d="M1 8.5V2.5a1 1 0 0 1 1-1h6l6.5 6.5-7 7L1 8.5z" />
    <circle cx="5" cy="5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const CalendarIcon = ({ size = 12, className = '' }) => (
  <svg {...svgProps(size, className)}>
    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" />
    <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
    <line x1="5" y1="1" x2="5" y2="4" />
    <line x1="11" y1="1" x2="11" y2="4" />
  </svg>
);
