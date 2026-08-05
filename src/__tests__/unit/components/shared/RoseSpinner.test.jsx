import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RoseSpinner, { ROSE_MIN_SIZE } from '../../../../components/shared/RoseSpinner';

/**
 * The rose-window loading mark. These lock the two things that break silently:
 * the size tiers (a mark that renders as mush tells you nothing) and gradient
 * id uniqueness (duplicate ids make every instance resolve to the first one's
 * stops, so a second spinner on the page silently loses its colours).
 */

const petals = (c) => c.container.querySelectorAll('.rose-unit');

describe('RoseSpinner', () => {
  it('RS-1 renders twelve petals, a band and a phase-locked arc at default size', () => {
    const c = render(<RoseSpinner size={48} />);
    expect(petals(c)).toHaveLength(12);
    expect(c.container.querySelector('.rose-band')).toBeInTheDocument();
    expect(c.container.querySelector('.rose-arc')).toBeInTheDocument();
  });

  it('RS-2 gives way to the conic ring below the cutover, with no SVG at all', () => {
    const c = render(<RoseSpinner size={ROSE_MIN_SIZE - 1} />);
    expect(c.container.querySelector('.rose-ring')).toBeInTheDocument();
    expect(c.container.querySelector('svg')).toBeNull();
  });

  it('RS-3 renders the window at exactly the cutover size', () => {
    const c = render(<RoseSpinner size={ROSE_MIN_SIZE} />);
    expect(c.container.querySelector('svg')).toBeInTheDocument();
    expect(c.container.querySelector('.rose-ring')).toBeNull();
  });

  it('RS-4 drops keystones below 48px, keeping them at and above', () => {
    // 3 keystones per petal: one on-axis circle plus two flanking rects
    const big = render(<RoseSpinner size={48} />);
    expect(big.container.querySelectorAll('.rose-unit rect')).toHaveLength(24);

    const small = render(<RoseSpinner size={40} />);
    expect(small.container.querySelectorAll('.rose-unit rect')).toHaveLength(0);
  });

  it('RS-5 drops the hexagram for a gold dot below 40px', () => {
    const withStar = render(<RoseSpinner size={40} />);
    expect(withStar.container.querySelectorAll('polygon.rose-star')).toHaveLength(2);

    const withDot = render(<RoseSpinner size={36} />);
    expect(withDot.container.querySelectorAll('polygon.rose-star')).toHaveLength(0);
    expect(withDot.container.querySelectorAll('circle.rose-star')).toHaveLength(1);
  });

  it('RS-6 gives each instance its own gradient ids', () => {
    const c = render(
      <>
        <RoseSpinner size={48} />
        <RoseSpinner size={48} />
      </>
    );
    const ids = [...c.container.querySelectorAll('linearGradient')].map((n) => n.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('RS-7 lays the six sampled hues around the ring twice', () => {
    const c = render(<RoseSpinner size={48} />);
    const hues = [...petals(c)].map(
      (g) => [...g.classList].find((n) => /^rose-h\d$/.test(n))
    );
    const expected = ['rose-h1', 'rose-h2', 'rose-h3', 'rose-h4', 'rose-h5', 'rose-h6'];
    expect(hues).toEqual([...expected, ...expected]);
  });

  it('RS-8 staggers the beam clockwise, so each petal lights after the one before it', () => {
    const c = render(<RoseSpinner size={48} />);
    // --i is the animation-delay index. Clockwise travel needs it to run
    // backwards through the ring: 0, 11, 10, 9 ... not 0, 1, 2, 3.
    const order = [...petals(c)].map((g) => g.style.getPropertyValue('--i'));
    expect(order).toEqual(['0', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1']);
  });

  it('RS-9 labels itself for assistive tech, preferring the caller text', () => {
    const plain = render(<RoseSpinner size={48} />);
    expect(plain.container.querySelector('svg')).toHaveAttribute('aria-label', 'Loading');

    const titled = render(<RoseSpinner size={48} label="Loading reservations" />);
    expect(titled.container.querySelector('svg')).toHaveAttribute(
      'aria-label',
      'Loading reservations'
    );
  });
});
