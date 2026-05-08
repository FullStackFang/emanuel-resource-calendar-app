// src/__tests__/unit/components/MecEventPreview.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MecEventPreview from '../../../components/preview/MecEventPreview';
import { toMecProps } from '../../../utils/mecPreviewMapper';

const baseEvent = {
  eventTitle: 'Ramblin Dans Band',
  eventDescription: 'Join us every Thursday for music!\n\nSession 1 is 9:30am.',
  startDate: '2026-05-14',
  startTime: '09:30',
  endDate: '2026-05-14',
  endTime: '10:15',
  isOffsite: false,
  locationDisplayNames: ['Temple Emanu-El'],
  categories: ['Families with Young Children'],
  eventType: 'singleInstance',
  webTitle: '',
  webDescription: '',
  webFeaturedImage: '',
  webRegisterUrl: '',
};

function renderPreview({ event = baseEvent, onChange = () => {} } = {}) {
  return render(
    <MecEventPreview
      mecProps={toMecProps(event)}
      formData={event}
      onWebFieldChange={onChange}
    />
  );
}

describe('MecEventPreview', () => {

  describe('rendering with mecProps', () => {
    it('renders nothing when mecProps is null/undefined', () => {
      const { container } = render(<MecEventPreview mecProps={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders the root container', () => {
      renderPreview();
      expect(screen.getByTestId('mec-preview-root')).toBeInTheDocument();
    });

    it('renders the human-formatted date and time', () => {
      renderPreview();
      expect(screen.getByText('May 14, 2026')).toBeInTheDocument();
      expect(screen.getByText('9:30 am')).toBeInTheDocument();
    });

    it('renders the venue name when locationDisplayNames is set', () => {
      renderPreview();
      expect(screen.getByText('Temple Emanu-El')).toBeInTheDocument();
    });

    it('renders the first category from categories[]', () => {
      renderPreview();
      expect(screen.getByText('Families with Young Children')).toBeInTheDocument();
    });
  });

  describe('editable Title input', () => {
    it('shows inherited eventTitle as placeholder when webTitle is empty', () => {
      renderPreview();
      const titleInput = screen.getByTestId('mec-preview-title-input');
      expect(titleInput).toHaveAttribute('placeholder', 'Ramblin Dans Band');
      expect(titleInput).toHaveValue('');
    });

    it('shows webTitle as the actual input value when overridden', () => {
      renderPreview({ event: { ...baseEvent, webTitle: 'Marketing-friendly Title' } });
      const titleInput = screen.getByTestId('mec-preview-title-input');
      expect(titleInput).toHaveValue('Marketing-friendly Title');
    });

    it('fires onWebFieldChange("webTitle", value) when user types', () => {
      const onChange = vi.fn();
      renderPreview({ onChange });
      const titleInput = screen.getByTestId('mec-preview-title-input');
      fireEvent.change(titleInput, { target: { value: 'New Title' } });
      expect(onChange).toHaveBeenCalledWith('webTitle', 'New Title');
    });
  });

  describe('editable Description textarea', () => {
    it('shows inherited eventDescription as placeholder when webDescription is empty', () => {
      renderPreview();
      const descInput = screen.getByTestId('mec-preview-content-input');
      // Placeholder shows the inherited description (full text)
      expect(descInput).toHaveAttribute('placeholder', baseEvent.eventDescription);
      expect(descInput).toHaveValue('');
    });

    it('shows webDescription as the actual textarea value when overridden', () => {
      renderPreview({ event: { ...baseEvent, webDescription: 'Public-facing copy' } });
      const descInput = screen.getByTestId('mec-preview-content-input');
      expect(descInput).toHaveValue('Public-facing copy');
    });

    it('fires onWebFieldChange("webDescription", value) when user types', () => {
      const onChange = vi.fn();
      renderPreview({ onChange });
      const descInput = screen.getByTestId('mec-preview-content-input');
      fireEvent.change(descInput, { target: { value: 'New body copy' } });
      expect(onChange).toHaveBeenCalledWith('webDescription', 'New body copy');
    });
  });

  describe('editable Featured Image input', () => {
    it('shows the striped placeholder when webFeaturedImage is empty', () => {
      renderPreview();
      expect(screen.getByTestId('mec-preview-featured-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('mec-preview-featured-image')).toBeNull();
    });

    it('shows the rendered image when webFeaturedImage is a valid URL', () => {
      renderPreview({ event: { ...baseEvent, webFeaturedImage: 'https://example.org/img.jpg' } });
      expect(screen.getByTestId('mec-preview-featured-image')).toBeInTheDocument();
      expect(screen.queryByTestId('mec-preview-featured-empty')).toBeNull();
    });

    it('keeps the placeholder when the URL is malformed (no http prefix)', () => {
      renderPreview({ event: { ...baseEvent, webFeaturedImage: 'not-a-url' } });
      expect(screen.getByTestId('mec-preview-featured-empty')).toBeInTheDocument();
    });

    it('fires onWebFieldChange("webFeaturedImage", value) when user pastes a URL', () => {
      const onChange = vi.fn();
      renderPreview({ onChange });
      const input = screen.getByTestId('mec-preview-featured-input');
      fireEvent.change(input, { target: { value: 'https://example.org/banner.jpg' } });
      expect(onChange).toHaveBeenCalledWith('webFeaturedImage', 'https://example.org/banner.jpg');
    });
  });

  describe('editable Register URL input', () => {
    it('shows the dashed placeholder when webRegisterUrl is empty', () => {
      renderPreview();
      expect(screen.getByTestId('mec-preview-register-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('mec-preview-register-button')).toBeNull();
    });

    it('shows a real Register button when webRegisterUrl is set', () => {
      renderPreview({ event: { ...baseEvent, webRegisterUrl: 'https://example.org/register' } });
      const button = screen.getByTestId('mec-preview-register-button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('href', 'https://example.org/register');
      expect(screen.queryByTestId('mec-preview-register-empty')).toBeNull();
    });

    it('fires onWebFieldChange("webRegisterUrl", value) when user types', () => {
      const onChange = vi.fn();
      renderPreview({ onChange });
      const input = screen.getByTestId('mec-preview-register-input');
      fireEvent.change(input, { target: { value: 'https://example.org/r' } });
      expect(onChange).toHaveBeenCalledWith('webRegisterUrl', 'https://example.org/r');
    });
  });

  describe('placeholders for empty meta facts', () => {
    it('shows DATE NOT SET when startDate is empty', () => {
      renderPreview({ event: { ...baseEvent, startDate: '' } });
      expect(screen.getByText('DATE NOT SET')).toBeInTheDocument();
    });

    it('shows TIME NOT SET when startTime is empty', () => {
      renderPreview({ event: { ...baseEvent, startTime: '' } });
      expect(screen.getByText('TIME NOT SET')).toBeInTheDocument();
    });

    it('shows LOCATION NOT SET when no rooms / no offsite name', () => {
      renderPreview({ event: { ...baseEvent, locationDisplayNames: [] } });
      expect(screen.getByText('LOCATION NOT SET')).toBeInTheDocument();
    });

    it('shows ADDRESS NOT SET when location name is set but address is missing (onsite)', () => {
      renderPreview();
      const locRow = screen.getByTestId('mec-preview-meta-location');
      expect(locRow).toHaveTextContent('Temple Emanu-El');
      expect(locRow).toHaveTextContent('ADDRESS NOT SET');
    });

    it('does NOT show ADDRESS NOT SET when offsite event provides offsiteAddress', () => {
      renderPreview({
        event: {
          ...baseEvent,
          isOffsite: true,
          offsiteName: 'Carnegie Hall',
          offsiteAddress: '881 7th Ave, New York, NY',
        },
      });
      expect(screen.getByText('Carnegie Hall')).toBeInTheDocument();
      expect(screen.getByText('881 7th Ave, New York, NY')).toBeInTheDocument();
      expect(screen.queryByText('ADDRESS NOT SET')).toBeNull();
    });

    it('shows CATEGORY NOT SET when categories is empty', () => {
      renderPreview({ event: { ...baseEvent, categories: [] } });
      expect(screen.getByText('CATEGORY NOT SET')).toBeInTheDocument();
    });
  });

  describe('recurring badge', () => {
    it('shows RECURRING pill only when eventType === seriesMaster', () => {
      renderPreview({
        event: {
          ...baseEvent,
          eventType: 'seriesMaster',
          recurrence: { range: { startDate: '2026-05-01' }, pattern: { type: 'weekly' } },
        },
      });
      expect(screen.getByTestId('mec-preview-recurring-badge')).toBeInTheDocument();
    });

    it('does NOT show RECURRING pill for singleInstance', () => {
      renderPreview();
      expect(screen.queryByTestId('mec-preview-recurring-badge')).toBeNull();
    });

    it('does NOT show RECURRING pill for occurrence', () => {
      renderPreview({ event: { ...baseEvent, eventType: 'occurrence', startDate: '2026-05-21' } });
      expect(screen.queryByTestId('mec-preview-recurring-badge')).toBeNull();
    });
  });

  describe('share row', () => {
    it('always renders the share section', () => {
      renderPreview();
      expect(screen.getByText('Share this event')).toBeInTheDocument();
    });
  });

  describe('inheritance behavior — overrides take precedence over inherited values', () => {
    it('rendered title input value comes from webTitle when set', () => {
      renderPreview({
        event: { ...baseEvent, eventTitle: 'Internal', webTitle: 'Public' },
      });
      expect(screen.getByTestId('mec-preview-title-input')).toHaveValue('Public');
    });

    it('rendered description input value comes from webDescription when set', () => {
      renderPreview({
        event: { ...baseEvent, eventDescription: 'Internal copy', webDescription: 'Public copy' },
      });
      expect(screen.getByTestId('mec-preview-content-input')).toHaveValue('Public copy');
    });
  });
});
