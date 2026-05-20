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
