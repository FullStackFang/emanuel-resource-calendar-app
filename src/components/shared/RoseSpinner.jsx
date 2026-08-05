import { useId } from 'react';
import './RoseSpinner.css';

/**
 * The Temple Emanu-El rose window, as a loading mark.
 *
 * Geometry is traced from public/emanuel_logo.png rather than eyeballed: twelve
 * petals at 15deg + n*30deg, each a circular head over a pinched neck, a hard
 * shoulder, and a straight-sided tapering wedge. Colours are the six sampled
 * hues (see --rose-* in design-tokens.css), repeated twice.
 *
 * Motion: the petal geometry NEVER rotates. A bright arc travels the outer band
 * and the petals wash bright just behind it, phase-locked to the same angular
 * rate, so the mark reads as light crossing stained glass. The hexagram stays
 * upright and still — spinning a religious symbol as a busy-indicator is not
 * something this app does.
 *
 * Detail sheds with size, and below ROSE_MIN_SIZE the window gives way to a
 * conic ring in the same hues. Twelve petals plus a hexagram plus thirty-six
 * keystones do not resolve at 20px.
 */

/** Below this, render the conic ring instead of the window. */
export const ROSE_MIN_SIZE = 32;

/**
 * The size every page-level loading state uses. Lives here rather than in
 * LoadingSpinner because Calendar renders the mark directly, and a second
 * hardcoded copy is how the two silently drifted apart once already.
 */
export const ROSE_DEFAULT_SIZE = 64;

/** Petal angle (deg clockwise from 12 o'clock) and hue index into the six. */
const PETALS = [
  { a: 15, h: 1 }, { a: 45, h: 2 }, { a: 75, h: 3 },
  { a: 105, h: 4 }, { a: 135, h: 5 }, { a: 165, h: 6 },
  { a: 195, h: 1 }, { a: 225, h: 2 }, { a: 255, h: 3 },
  { a: 285, h: 4 }, { a: 315, h: 5 }, { a: 345, h: 6 },
];

/**
 * Petal pointing up, viewBox 0 0 100 100, centre (50,50).
 * Head circle r5.2 at y20.6 · neck in to hw3.4 at y23.2 · hard shoulder out to
 * hw5.6 · straight taper to hw2.9 at y35 · point at y37.9.
 */
const PETAL_D = [
  'M50 15.4',
  'A5.2 5.2 0 0 1 55.2 20.6',
  'Q55.0 22.3 53.4 23.2',
  'L53.4 23.9 L55.6 24.1 L52.9 35.0 L52.5 35.9 L50 37.9',
  'L47.5 35.9 L47.1 35.0 L44.4 24.1 L46.6 23.9 L46.6 23.2',
  'Q45.0 22.3 44.8 20.6',
  'A5.2 5.2 0 0 1 50 15.4 Z',
].join(' ');

/** Hexagram, circumradius 10.2, as two triangles. */
const STAR = [0, 1].map((t) =>
  [0, 1, 2]
    .map((k) => {
      const ang = ((k * 120 + t * 60 - 90) * Math.PI) / 180;
      return `${(50 + 10.2 * Math.cos(ang)).toFixed(2)},${(50 + 10.2 * Math.sin(ang)).toFixed(2)}`;
    })
    .join(' ')
);

const RoseSpinner = ({ size = ROSE_DEFAULT_SIZE, className = '', label = 'Loading' }) => {
  // useId keeps the gradient ids unique when several spinners mount at once;
  // duplicate ids would make every instance resolve to the first one's stops.
  const uid = useId().replace(/:/g, '');

  if (size < ROSE_MIN_SIZE) {
    return (
      <span
        className={`rose-ring ${className}`}
        style={{ width: size, height: size, '--rose-ring-w': `${Math.max(2, size / 5.6)}px` }}
        role="img"
        aria-label={label}
      />
    );
  }

  // Keystones are ~1px of arc below 48px, so they read as noise rather than ornament.
  const showKeystones = size >= 48;
  // The hexagram's interior notches close up below 40px and it blots into a disc.
  const showStar = size >= 40;
  const bandW = size < 40 ? 2.8 : 3.65;

  return (
    <svg
      className={`rose-spinner ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`rsBand${uid}`} x1="0.15" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="var(--rose-band-light)" />
          <stop offset="0.5" stopColor="var(--rose-band-mid)" />
          <stop offset="1" stopColor="var(--rose-band-deep)" />
        </linearGradient>
        <linearGradient id={`rsArc${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--rose-sapphire)" />
          <stop offset="1" stopColor="var(--rose-cyan)" />
        </linearGradient>
      </defs>

      <circle
        className="rose-band"
        cx="50"
        cy="50"
        r="46.4"
        fill="none"
        strokeWidth={bandW}
        stroke={`url(#rsBand${uid})`}
      />
      <circle
        className="rose-arc"
        cx="50"
        cy="50"
        r="46.4"
        fill="none"
        strokeWidth={bandW + 1.5}
        strokeLinecap="round"
        strokeDasharray="70 222"
        stroke={`url(#rsArc${uid})`}
      />

      {PETALS.map(({ a, h }, i) => (
        <g
          key={a}
          className={`rose-unit rose-h${h}`}
          /* Clockwise travel: petal i must light AFTER petal i-1, so the
             negative delay runs backwards through the ring. */
          style={{ '--i': (12 - i) % 12, transform: `rotate(${a}deg)` }}
        >
          <path d={PETAL_D} />
          {showKeystones && (
            <>
              <circle cx="50" cy="12.1" r="1.9" />
              <rect x="48.1" y="10.2" width="3.8" height="4.6" rx="1.3" transform="rotate(-8 50 50)" />
              <rect x="48.1" y="10.2" width="3.8" height="4.6" rx="1.3" transform="rotate(8 50 50)" />
            </>
          )}
        </g>
      ))}

      {showStar ? (
        STAR.map((points) => <polygon key={points} className="rose-star" points={points} />)
      ) : (
        <circle className="rose-star" cx="50" cy="50" r="6.4" />
      )}
    </svg>
  );
};

export default RoseSpinner;
