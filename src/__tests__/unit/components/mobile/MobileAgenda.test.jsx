// src/__tests__/unit/components/mobile/MobileAgenda.test.jsx
//
// The agenda's two gesture/scroll behaviors, isolated from the shell: the
// scroll spy that reports which day is at the top of the viewport, and
// pull-to-refresh's deference to the shell's locked swipe axis.
//
// jsdom has no layout, so every geometry read is stubbed explicitly —
// `getBoundingClientRect` on the list and its day sections, plus a `scrollTop`
// accessor. That is also why the scroll spy is a pure function fed from here
// rather than an IntersectionObserver.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import MobileAgenda from '../../../../components/mobile/MobileAgenda';

const SECTION_HEIGHT = 100;

/** Jul 12 (Sun) .. Jul 18 2026 — one week of sections is enough to scroll. */
const DATES = Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 12 + i));

function rect(top) {
  return { top, bottom: top + SECTION_HEIGHT, height: SECTION_HEIGHT, left: 0, right: 400, width: 400, x: 0, y: top };
}

/**
 * Give the list a fake layout: section N starts at N * SECTION_HEIGHT in
 * content space, and the list's own box sits at viewport top 0.
 */
function stubGeometry(container) {
  const list = container.querySelector('.mobile-agenda-list');
  let scrollTop = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v) => { scrollTop = v; },
  });
  list.getBoundingClientRect = () => rect(0);

  const measure = () => {
    container.querySelectorAll('.mobile-agenda-day').forEach((el, i) => {
      el.getBoundingClientRect = () => rect(i * SECTION_HEIGHT - scrollTop);
    });
  };
  measure();

  return {
    list,
    /** Scroll so that section `index` sits exactly at the top of the viewport. */
    scrollToSection(index) {
      scrollTop = index * SECTION_HEIGHT;
      measure();
      fireEvent.scroll(list);
    },
  };
}

function renderAgenda(props = {}) {
  const onVisibleDateChange = vi.fn();
  const onRefresh = vi.fn();
  const utils = render(
    <MobileAgenda
      selectedDate={DATES[0]}
      datesToShow={DATES}
      groupedEvents={{}}
      loading={false}
      refreshing={false}
      error={null}
      onEventTap={vi.fn()}
      onRefresh={onRefresh}
      onRetry={vi.fn()}
      onVisibleDateChange={onVisibleDateChange}
      {...props}
    />
  );
  return { ...utils, onVisibleDateChange, onRefresh, geo: stubGeometry(utils.container) };
}

/** The reported Date, as a 'YYYY-MM-DD' key. */
function reportedKeys(spy) {
  return spy.mock.calls.map(([d]) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

describe('MobileAgenda scroll spy', () => {
  beforeEach(() => {
    // Run the rAF throttle inline: the observation is what is under test, not
    // the frame scheduling.
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports the day whose section reaches the top of the viewport', () => {
    const { geo, onVisibleDateChange } = renderAgenda();

    geo.scrollToSection(2); // Jul 14

    expect(reportedKeys(onVisibleDateChange)).toEqual(['2026-07-14']);
  });

  it('reports each new day once, not once per scroll frame', () => {
    const { geo, onVisibleDateChange } = renderAgenda();

    geo.scrollToSection(1);
    fireEvent.scroll(geo.list); // same position, another frame
    geo.scrollToSection(2);

    expect(reportedKeys(onVisibleDateChange)).toEqual(['2026-07-13', '2026-07-14']);
  });

  it('does not report while scrolled above the first section', () => {
    const { geo, onVisibleDateChange } = renderAgenda();

    fireEvent.scroll(geo.list); // still at the top, on Jul 12

    expect(onVisibleDateChange).toHaveBeenCalledWith(DATES[0]);
    expect(onVisibleDateChange).toHaveBeenCalledTimes(1);
  });

  it('ignores intervening days while a programmatic scroll is in flight', () => {
    const { geo, onVisibleDateChange, rerender } = renderAgenda();

    // A tap two days out arms the ignore-window and starts a smooth scroll.
    rerender(
      <MobileAgenda
        selectedDate={DATES[3]}
        datesToShow={DATES}
        groupedEvents={{}}
        loading={false}
        refreshing={false}
        error={null}
        onEventTap={vi.fn()}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
        onVisibleDateChange={onVisibleDateChange}
      />
    );

    geo.scrollToSection(1); // Jul 13, passed through
    geo.scrollToSection(2); // Jul 14, passed through
    expect(onVisibleDateChange).not.toHaveBeenCalled();

    geo.scrollToSection(3); // the target lands — the shell already has this day
    expect(onVisibleDateChange).not.toHaveBeenCalled();

    // ...and observation resumes from there.
    geo.scrollToSection(4);
    expect(reportedKeys(onVisibleDateChange)).toEqual(['2026-07-16']);
  });

  it('resumes observing when the user takes the list over mid-animation', () => {
    const { geo, onVisibleDateChange, container, rerender } = renderAgenda();

    rerender(
      <MobileAgenda
        selectedDate={DATES[5]}
        datesToShow={DATES}
        groupedEvents={{}}
        loading={false}
        refreshing={false}
        error={null}
        onEventTap={vi.fn()}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
        onVisibleDateChange={onVisibleDateChange}
      />
    );

    // The user grabs the list before the animation reaches Jul 17; without the
    // touch clearing the target, the spy would stay deaf until the next tap.
    fireEvent.touchStart(container.querySelector('.mobile-agenda-list'), {
      touches: [{ clientX: 0, clientY: 300 }],
    });
    geo.scrollToSection(1);

    expect(reportedKeys(onVisibleDateChange)).toEqual(['2026-07-13']);
  });

  it('does nothing when the shell passes no observer', () => {
    const { geo } = renderAgenda({ onVisibleDateChange: undefined });

    expect(() => geo.scrollToSection(2)).not.toThrow();
  });
});

describe('MobileAgenda pull-to-refresh', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Drag down `distance` px starting from the top of the list. */
  function pull(list, distance) {
    fireEvent.touchStart(list, { touches: [{ clientX: 0, clientY: 100 }] });
    fireEvent.touchEnd(list, { changedTouches: [{ clientX: 0, clientY: 100 + distance }] });
  }

  it('refreshes on a pull from the top past the threshold', () => {
    const { geo, onRefresh } = renderAgenda();

    pull(geo.list, 120);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a short pull', () => {
    const { geo, onRefresh } = renderAgenda();

    pull(geo.list, 40);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh when the gesture has locked to the horizontal axis', () => {
    const axisRef = { current: 'x' };
    const { geo, onRefresh } = renderAgenda({ axisRef });

    // Far enough down to satisfy the pull threshold on its own.
    pull(geo.list, 120);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('still refreshes when the gesture locked vertical', () => {
    const axisRef = { current: 'y' };
    const { geo, onRefresh } = renderAgenda({ axisRef });

    pull(geo.list, 120);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the list was not at the top', () => {
    const { geo, onRefresh } = renderAgenda();
    geo.list.scrollTop = 400;

    pull(geo.list, 120);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
