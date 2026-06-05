// src/__tests__/unit/components/MobileEventDetail.test.jsx
//
// Locks the read-only floor-plan surface in the mobile detail sheet:
//  - a "Floor Plan" field renders (only) when the event has a floor plan image
//  - tapping the thumbnail opens a fullscreen lightbox; close/zoom behave
//
// useFloorPlan is mocked (its fetch/blob path is covered by useFloorPlan.test.js)
// so these tests focus purely on the component's rendering + lightbox logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'tok' }),
}));
vi.mock('../../../hooks/useScrollLock', () => ({ default: vi.fn() }));

let mockFloorPlan;
vi.mock('../../../hooks/useFloorPlan', () => ({
  default: () => mockFloorPlan,
}));

import MobileEventDetail from '../../../components/mobile/MobileEventDetail';

const baseEvent = {
  eventId: 'evt-1',
  eventTitle: 'Spring Gala',
  status: 'published',
  startDate: '2026-05-01',
};

describe('MobileEventDetail — floor plan', () => {
  beforeEach(() => {
    mockFloorPlan = { floorPlanUrl: null, fileName: '' };
  });

  it('renders a Floor Plan field with the image when a plan exists', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.getByText('Floor Plan')).toBeTruthy();
    const img = screen.getByRole('img', { name: /floor plan/i });
    expect(img.getAttribute('src')).toBe('blob:plan');
  });

  it('does not render a Floor Plan field when there is no plan', () => {
    mockFloorPlan = { floorPlanUrl: null, fileName: '' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.queryByText('Floor Plan')).toBeNull();
    expect(screen.queryByRole('button', { name: /view floor plan/i })).toBeNull();
  });

  it('opens the fullscreen lightbox when the thumbnail is tapped', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    expect(screen.getByRole('dialog', { name: /floor plan/i })).toBeTruthy();
  });

  it('closes the lightbox via the close button', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /close floor plan/i }));
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });

  it('closes the lightbox when the backdrop outside the image is tapped', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /floor plan/i }));
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });

  it('toggles zoom when the lightbox image is tapped (and stays open)', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    const { container } = render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    const dialog = screen.getByRole('dialog', { name: /floor plan/i });
    const stage = container.querySelector('.mobile-detail-lightbox-stage');
    expect(stage.classList.contains('zoomed')).toBe(false);

    fireEvent.click(within(dialog).getByRole('img', { name: /floor plan/i }));
    expect(stage.classList.contains('zoomed')).toBe(true);
    // tapping the image must not close the lightbox
    expect(screen.getByRole('dialog', { name: /floor plan/i })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('img', { name: /floor plan/i }));
    expect(stage.classList.contains('zoomed')).toBe(false);
  });

  it('closes the lightbox on Escape', () => {
    mockFloorPlan = { floorPlanUrl: 'blob:plan', fileName: 'social-hall.png' };

    render(<MobileEventDetail event={baseEvent} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /view floor plan/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /floor plan/i })).toBeNull();
  });
});
