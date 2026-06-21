import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture every doc.text(...) call so we can assert what got drawn into the PDF.
const textCalls = [];

vi.mock('jspdf', () => {
  class FakeDoc {
    constructor() {
      this.internal = {
        pageSize: { getWidth: () => 210, getHeight: () => 297 },
        getNumberOfPages: () => 1,
      };
    }
    setProperties() {}
    setDrawColor() {}
    setFillColor() {}
    setTextColor() {}
    setLineWidth() {}
    setFont() {}
    setFontSize() {}
    line() {}
    rect() {}
    roundedRect() {}
    addPage() {}
    setPage() {}
    getTextWidth(s) { return String(s).length; }
    // jsPDF wraps text into an array of lines; tests use single-line strings.
    splitTextToSize(s) { return [String(s)]; }
    text(str) { textCalls.push(Array.isArray(str) ? str.join(' ') : String(str)); }
    output() { return new Blob(['pdf']); }
  }
  return { jsPDF: FakeDoc };
});

// URL.createObjectURL is not implemented in jsdom.
beforeEach(() => {
  textCalls.length = 0;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
});

const { generateCalendarPdf } = await import('../../../utils/calendarPdfGenerator');

const baseEvent = {
  id: '1',
  subject: 'Board Meeting',
  start: { dateTime: '2026-05-20T18:00:00Z' },
  end: { dateTime: '2026-05-20T20:00:00Z' },
  location: { displayName: 'Greenwald Hall' },
  categories: ['Meeting'],
  bodyPreview: '',
};

const drewText = (substr) => textCalls.some((t) => t.includes(substr));
const countText = (substr) => textCalls.filter((t) => t.includes(substr)).length;

describe('generateCalendarPdf attendee count', () => {
  it('PDFAC-1: draws attendee count when attendeeCount is a positive number', () => {
    generateCalendarPdf({ events: [{ ...baseEvent, attendeeCount: 50 }] });
    expect(drewText('50 attendees')).toBe(true);
  });

  it('PDFAC-2: uses singular "attendee" for a count of 1', () => {
    generateCalendarPdf({ events: [{ ...baseEvent, attendeeCount: 1 }] });
    expect(drewText('1 attendee')).toBe(true);
    expect(drewText('1 attendees')).toBe(false);
  });

  it('PDFAC-3: accepts numeric string values', () => {
    generateCalendarPdf({ events: [{ ...baseEvent, attendeeCount: '125' }] });
    expect(drewText('125 attendees')).toBe(true);
  });

  it('PDFAC-4: omits the line when attendeeCount is missing', () => {
    generateCalendarPdf({ events: [{ ...baseEvent }] });
    expect(drewText('attendee')).toBe(false);
  });

  it('PDFAC-5: omits the line when attendeeCount is zero or empty', () => {
    generateCalendarPdf({ events: [{ ...baseEvent, attendeeCount: 0 }] });
    expect(drewText('attendee')).toBe(false);
    textCalls.length = 0;
    generateCalendarPdf({ events: [{ ...baseEvent, attendeeCount: '' }] });
    expect(drewText('attendee')).toBe(false);
  });
});

describe('generateCalendarPdf calendar markers', () => {
  // baseEvent falls on 2026-05-20 in America/New_York (the generator default tz).
  const holiday = (over = {}) => ({
    _id: 'h1', type: 'holiday', name: 'Shavuot',
    startDate: '2026-05-20', endDate: '2026-05-20', active: true, ...over,
  });
  const closure = (over = {}) => ({
    _id: 'c1', type: 'officeClosed', name: 'Maintenance Shutdown',
    startDate: '2026-05-20', endDate: '2026-05-22', active: true, ...over,
  });

  it('PDFMK-1: draws a single-day holiday banner on its day', () => {
    generateCalendarPdf({
      events: [baseEvent],
      markers: [holiday()],
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-20' } },
    });
    expect(drewText('Shavuot')).toBe(true);
    expect(drewText('HOLIDAY')).toBe(true);
  });

  it('PDFMK-2: repeats a multi-day closure on every day in its range', () => {
    generateCalendarPdf({
      events: [baseEvent], // events only on 2026-05-20
      markers: [closure()], // spans 2026-05-20 .. 2026-05-22
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-22' } },
    });
    // One banner per covered day: 05-20 (has event), 05-21, 05-22 (empty).
    expect(countText('Maintenance Shutdown')).toBe(3);
  });

  it('PDFMK-3: prints a marker-only day with a "No events scheduled." line', () => {
    generateCalendarPdf({
      events: [baseEvent], // 2026-05-20
      markers: [holiday({ startDate: '2026-05-21', endDate: '2026-05-21' })],
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-21' } },
    });
    expect(drewText('No events scheduled.')).toBe(true);
    expect(drewText('May 21, 2026')).toBe(true); // the empty day's date pill
  });

  it('PDFMK-4: the events total excludes markers', () => {
    generateCalendarPdf({
      events: [baseEvent],
      markers: [holiday(), closure()],
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-22' } },
    });
    expect(drewText('Total: 1 events')).toBe(true);
  });

  it('PDFMK-5: category sort shows a summary block, not per-day banners', () => {
    generateCalendarPdf({
      events: [baseEvent],
      markers: [holiday()],
      sortBy: 'category',
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-20' } },
    });
    expect(drewText('HOLIDAYS & CLOSURES IN THIS RANGE')).toBe(true);
    expect(drewText('Shavuot')).toBe(true);
  });

  it('PDFMK-6: omits all marker artifacts when no markers are supplied', () => {
    generateCalendarPdf({ events: [baseEvent] });
    expect(drewText('OFFICE CLOSED')).toBe(false);
    expect(drewText('No events scheduled.')).toBe(false);
    expect(drewText('HOLIDAYS & CLOSURES')).toBe(false);
    expect(drewText('Board Meeting')).toBe(true); // normal event still renders
  });

  it('PDFMK-7: clips a multi-day marker to the search date range', () => {
    generateCalendarPdf({
      events: [],
      markers: [closure({ startDate: '2026-05-18', endDate: '2026-05-25' })],
      searchCriteria: { dateRange: { start: '2026-05-20', end: '2026-05-21' } },
    });
    // Only 05-20 and 05-21 fall inside the range → two banners, not eight.
    expect(countText('Maintenance Shutdown')).toBe(2);
  });
});
