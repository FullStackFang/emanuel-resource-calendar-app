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
import { render, fireEvent, act } from '@testing-library/react';
import MobileAgenda from '../../../../components/mobile/MobileAgenda';

const SECTION_HEIGHT = 100;

// `stubGeometry` patches the prototype so that sections rendered later are
// covered; restore it unconditionally so a failing test cannot leak layout
// stubs into the next one.
const PRISTINE_RECT = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = PRISTINE_RECT;
});

/** Jul 12 (Sun) .. Jul 18 2026 — one week of sections is enough to scroll. */
const DATES = Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 12 + i));

function rect(top) {
  return { top, bottom: top + SECTION_HEIGHT, height: SECTION_HEIGHT, left: 0, right: 400, width: 400, x: 0, y: top };
}

/**
 * Give the list a fake layout: section N starts at N * SECTION_HEIGHT in
 * content space, and the list's own box sits at viewport top 0.
 */
const VIEWPORT_HEIGHT = 200;

function stubGeometry(container) {
  const list = container.querySelector('.mobile-agenda-list');
  let scrollTop = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v) => { scrollTop = v; },
  });
  const sectionCount = () => container.querySelectorAll('.mobile-agenda-day').length;
  Object.defineProperty(list, 'scrollHeight', {
    configurable: true,
    get: () => sectionCount() * SECTION_HEIGHT,
  });
  Object.defineProperty(list, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  list.getBoundingClientRect = () => rect(0);

  // Resolved at call time, on the prototype, so that sections rendered LATER
  // are covered too — a layout effect reads geometry during the same commit
  // that adds them, long before a test could stub the new nodes. It also means
  // a prepend genuinely moves every pre-existing section down, which is the
  // condition the scroll anchor exists to cancel.
  const originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stubbedRect() {
    if (this === list) return rect(0);
    if (this.classList?.contains('mobile-agenda-day')) {
      const index = [...container.querySelectorAll('.mobile-agenda-day')].indexOf(this);
      return rect(index * SECTION_HEIGHT - scrollTop);
    }
    return originalRect.call(this);
  };

  return {
    list,
    restore: () => { Element.prototype.getBoundingClientRect = originalRect; },
    scrollTopValue: () => scrollTop,
    /** Scroll so that section `index` sits exactly at the top of the viewport. */
    scrollToSection(index) {
      scrollTop = index * SECTION_HEIGHT;
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

describe('MobileAgenda range extension', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Jul 5 .. Jul 18 — the same week as DATES, with a week prepended. */
  const EARLIER_DATES = [
    ...Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 5 + i)),
    ...DATES,
  ];
  /** Jul 12 .. Jul 25 — the same week as DATES, with a week appended. */
  const LATER_DATES = [
    ...DATES,
    ...Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 19 + i)),
  ];

  it('asks to extend forward when scrolled down toward the bottom', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('covered');
    const { geo } = renderAgenda({ onExtendRange });

    geo.scrollToSection(5);
    await act(async () => {});

    expect(onExtendRange).toHaveBeenCalledWith('future');

  });

  it('asks to extend backward when scrolled up toward the top', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('covered');
    const { geo } = renderAgenda({ onExtendRange });

    geo.scrollToSection(4);
    await act(async () => {});
    onExtendRange.mockClear();
    geo.scrollToSection(0);
    await act(async () => {});

    expect(onExtendRange).toHaveBeenCalledWith('past');

  });

  it('does not ask again from the same offset', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('covered');
    const { geo } = renderAgenda({ onExtendRange });

    geo.scrollToSection(5);
    await act(async () => {});
    expect(onExtendRange).toHaveBeenCalledTimes(1);

    // Parked: the reader has not moved, so re-arming here would chain requests.
    fireEvent.scroll(geo.list);
    await act(async () => {});

    expect(onExtendRange).toHaveBeenCalledTimes(1);

  });

  it('holds the reader in place when days are prepended', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('covered');
    const { geo, rerender } = renderAgenda({ onExtendRange });

    geo.scrollToSection(3);
    await act(async () => {});
    expect(geo.scrollTopValue()).toBe(300);

    // Seven sections arrive above the reader — 700px of content.
    await act(async () => {
      rerender(
        <MobileAgenda
          selectedDate={DATES[0]}
          datesToShow={EARLIER_DATES}
          groupedEvents={{}}
          loading={false}
          refreshing={false}
          error={null}
          onEventTap={vi.fn()}
          onRefresh={vi.fn()}
          onRetry={vi.fn()}
          onVisibleDateChange={vi.fn()}
          onExtendRange={onExtendRange}
        />
      );
    });

    // Same day still under the reader's eye, so scrollTop absorbs the growth.
    expect(geo.scrollTopValue()).toBe(1000);

  });

  it('leaves scroll position alone when days are appended', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('covered');
    const { geo, rerender } = renderAgenda({ onExtendRange });

    geo.scrollToSection(3);
    await act(async () => {});

    await act(async () => {
      rerender(
        <MobileAgenda
          selectedDate={DATES[0]}
          datesToShow={LATER_DATES}
          groupedEvents={{}}
          loading={false}
          refreshing={false}
          error={null}
          onEventTap={vi.fn()}
          onRefresh={vi.fn()}
          onRetry={vi.fn()}
          onVisibleDateChange={vi.fn()}
          onExtendRange={onExtendRange}
        />
      );
    });

    // Content added below the anchor moves it by zero.
    expect(geo.scrollTopValue()).toBe(300);

  });

  it('offers a retry at the failed end and re-requests on tap', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('error');
    const { geo, getByRole, container } = renderAgenda({ onExtendRange });

    geo.scrollToSection(5);
    await act(async () => {});

    // The list the reader already had is untouched.
    expect(container.querySelectorAll('.mobile-agenda-day').length).toBe(7);
    const retry = getByRole('button', { name: /Couldn't load more events/i });

    onExtendRange.mockResolvedValue('covered');
    await act(async () => { fireEvent.click(retry); });

    expect(onExtendRange).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.mobile-agenda-extend-retry')).toBeNull();

  });

  it('leaves the retry alone when a request is merely suppressed', async () => {
    const onExtendRange = vi.fn().mockResolvedValue('suppressed');
    const { geo, container } = renderAgenda({ onExtendRange });

    geo.scrollToSection(5);
    await act(async () => {});

    // Neither success nor failure: nothing to retry, nothing to celebrate.
    expect(container.querySelector('.mobile-agenda-extend-retry')).toBeNull();
    expect(container.querySelectorAll('.mobile-agenda-day').length).toBe(7);

  });

  it('does nothing when the shell provides no extend handler', async () => {
    const { geo, container } = renderAgenda();

    expect(() => geo.scrollToSection(5)).not.toThrow();
    await act(async () => {});

    expect(container.querySelector('.mobile-agenda-extend')).toBeNull();

  });
});
