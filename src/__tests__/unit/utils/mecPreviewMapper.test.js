/**
 * Tests for mecPreviewMapper.js
 *
 * Maps the flat event shape (post-transformEventToFlatStructure) into the
 * MEC widget props shape consumed by MecEventPreview.
 *
 * Uses NOT_SET sentinel for missing fields so the render component can show
 * placeholders instead of falsy guards everywhere.
 */

import { describe, it, expect } from 'vitest';
import {
  toMecProps,
  isMissing,
  collectGaps,
  NOT_SET
} from '../../../utils/mecPreviewMapper';

describe('mecPreviewMapper', () => {

  describe('toMecProps - fields with no internal counterpart', () => {
    it('emits NOT_SET for featuredImageUrl when webFeaturedImage is empty', () => {
      const props = toMecProps({ eventTitle: 'X' });
      expect(props.featuredImageUrl).toBe(NOT_SET);
    });

    it('emits NOT_SET for registerUrl when webRegisterUrl is empty', () => {
      const props = toMecProps({ eventTitle: 'X' });
      expect(props.registerUrl).toBe(NOT_SET);
    });

    it('uses webFeaturedImage when set', () => {
      const props = toMecProps({ webFeaturedImage: 'https://example.org/img.jpg' });
      expect(props.featuredImageUrl).toBe('https://example.org/img.jpg');
    });

    it('uses webRegisterUrl when set', () => {
      const props = toMecProps({ webRegisterUrl: 'https://example.org/register' });
      expect(props.registerUrl).toBe('https://example.org/register');
    });
  });

  describe('toMecProps - web override resolution', () => {
    it('uses webTitle when set, ignoring eventTitle', () => {
      const props = toMecProps({ webTitle: 'Public title', eventTitle: 'Internal title' });
      expect(props.title).toBe('Public title');
    });

    it('falls back to eventTitle when webTitle is empty string', () => {
      const props = toMecProps({ webTitle: '', eventTitle: 'Internal title' });
      expect(props.title).toBe('Internal title');
    });

    it('falls back to eventTitle when webTitle is missing entirely', () => {
      const props = toMecProps({ eventTitle: 'Internal title' });
      expect(props.title).toBe('Internal title');
    });

    it('uses webDescription when set, ignoring eventDescription', () => {
      const props = toMecProps({ webDescription: 'Public copy', eventDescription: 'Internal copy' });
      expect(props.description).toBe('Public copy');
    });

    it('falls back to eventDescription when webDescription is empty', () => {
      const props = toMecProps({ webDescription: '', eventDescription: 'Internal copy' });
      expect(props.description).toBe('Internal copy');
    });

    it('emits NOT_SET when both web override AND inherited field are empty', () => {
      const props = toMecProps({});
      expect(props.title).toBe(NOT_SET);
      expect(props.description).toBe(NOT_SET);
    });
  });

  describe('toMecProps - title / description / dates', () => {
    it('passes through title when present', () => {
      const props = toMecProps({ eventTitle: 'Ramblin Dans Band' });
      expect(props.title).toBe('Ramblin Dans Band');
    });

    it('emits NOT_SET when title is empty string', () => {
      const props = toMecProps({ eventTitle: '' });
      expect(props.title).toBe(NOT_SET);
    });

    it('emits NOT_SET when title is missing entirely', () => {
      const props = toMecProps({});
      expect(props.title).toBe(NOT_SET);
    });

    it('passes through description when present', () => {
      const props = toMecProps({ eventDescription: 'Join us!' });
      expect(props.description).toBe('Join us!');
    });

    it('emits NOT_SET when description is empty', () => {
      const props = toMecProps({ eventDescription: '' });
      expect(props.description).toBe(NOT_SET);
    });

    it('passes through start/end date and time', () => {
      const props = toMecProps({
        startDate: '2026-05-14',
        startTime: '09:30',
        endDate: '2026-05-14',
        endTime: '10:15',
      });
      expect(props.startDate).toBe('2026-05-14');
      expect(props.startTime).toBe('09:30');
      expect(props.endDate).toBe('2026-05-14');
      expect(props.endTime).toBe('10:15');
    });

    it('emits NOT_SET for missing startDate / startTime', () => {
      const props = toMecProps({});
      expect(props.startDate).toBe(NOT_SET);
      expect(props.startTime).toBe(NOT_SET);
    });

    it('emits null for missing endDate / endTime (optional fields)', () => {
      const props = toMecProps({ startDate: '2026-05-14', startTime: '09:30' });
      expect(props.endDate).toBeNull();
      expect(props.endTime).toBeNull();
    });
  });

  describe('toMecProps - location (offsite vs onsite)', () => {
    it('uses offsiteName + offsiteAddress when isOffsite is true', () => {
      const props = toMecProps({
        isOffsite: true,
        offsiteName: 'Carnegie Hall',
        offsiteAddress: '881 7th Ave, New York, NY',
      });
      expect(props.locationName).toBe('Carnegie Hall');
      expect(props.locationAddress).toBe('881 7th Ave, New York, NY');
    });

    it('emits NOT_SET for offsiteName when offsite but name missing', () => {
      const props = toMecProps({ isOffsite: true });
      expect(props.locationName).toBe(NOT_SET);
      expect(props.locationAddress).toBe(NOT_SET);
    });

    it('uses first locationDisplayNames entry when onsite (array form)', () => {
      const props = toMecProps({
        isOffsite: false,
        locationDisplayNames: ['Temple Emanu-El', 'Sanctuary'],
      });
      expect(props.locationName).toBe('Temple Emanu-El');
    });

    it('treats locationDisplayNames as a single name when given as a string', () => {
      const props = toMecProps({
        isOffsite: false,
        locationDisplayNames: 'Temple Emanu-El',
      });
      expect(props.locationName).toBe('Temple Emanu-El');
    });

    it('emits NOT_SET when onsite and locationDisplayNames is empty array', () => {
      const props = toMecProps({ isOffsite: false, locationDisplayNames: [] });
      expect(props.locationName).toBe(NOT_SET);
    });

    it('emits NOT_SET when onsite and locationDisplayNames is empty string', () => {
      const props = toMecProps({ isOffsite: false, locationDisplayNames: '' });
      expect(props.locationName).toBe(NOT_SET);
    });

    it('always emits NOT_SET for locationAddress when onsite (no field in v1)', () => {
      const props = toMecProps({
        isOffsite: false,
        locationDisplayNames: ['Temple Emanu-El'],
      });
      expect(props.locationAddress).toBe(NOT_SET);
    });
  });

  describe('toMecProps - categories', () => {
    it('uses first category when array non-empty', () => {
      const props = toMecProps({ categories: ['Families with Young Children', 'Music'] });
      expect(props.categoryName).toBe('Families with Young Children');
    });

    it('emits NOT_SET when categories is empty array', () => {
      const props = toMecProps({ categories: [] });
      expect(props.categoryName).toBe(NOT_SET);
    });

    it('emits NOT_SET when categories is missing', () => {
      const props = toMecProps({});
      expect(props.categoryName).toBe(NOT_SET);
    });
  });

  describe('toMecProps - recurrence metadata', () => {
    it('passes through eventType (singleInstance)', () => {
      const props = toMecProps({ eventType: 'singleInstance' });
      expect(props.eventType).toBe('singleInstance');
    });

    it('passes through eventType (seriesMaster) and recurrence object', () => {
      const recurrence = { range: { startDate: '2026-05-01' }, pattern: { type: 'weekly' } };
      const props = toMecProps({ eventType: 'seriesMaster', recurrence });
      expect(props.eventType).toBe('seriesMaster');
      expect(props.recurrence).toBe(recurrence);
    });

    it('uses recurrence.range.startDate as displayed startDate for seriesMaster', () => {
      const props = toMecProps({
        eventType: 'seriesMaster',
        startDate: '2026-05-07',                          // first-occurrence date
        recurrence: { range: { startDate: '2026-05-01' } } // series span start
      });
      expect(props.startDate).toBe('2026-05-01');
    });

    it('falls back to startDate for seriesMaster when recurrence.range.startDate is missing', () => {
      const props = toMecProps({
        eventType: 'seriesMaster',
        startDate: '2026-05-07',
        recurrence: { pattern: { type: 'weekly' } } // no range
      });
      expect(props.startDate).toBe('2026-05-07');
    });

    it('uses the event startDate (occurrence override) for occurrence type', () => {
      const props = toMecProps({
        eventType: 'occurrence',
        startDate: '2026-05-21',
        recurrence: { range: { startDate: '2026-05-01' } }
      });
      // The mapper does NOT override an occurrence's date with the master range.
      expect(props.startDate).toBe('2026-05-21');
    });

    it('passes through eventType (occurrence)', () => {
      const props = toMecProps({ eventType: 'occurrence' });
      expect(props.eventType).toBe('occurrence');
    });

    it('emits null for recurrence when missing', () => {
      const props = toMecProps({ eventType: 'singleInstance' });
      expect(props.recurrence).toBeNull();
    });
  });

  describe('toMecProps - null/undefined safety', () => {
    it('handles a fully empty event object without throwing', () => {
      expect(() => toMecProps({})).not.toThrow();
    });

    it('all NOT_SET fields are === NOT_SET (referentially equal)', () => {
      const props = toMecProps({});
      // All sentinel checks should use referential equality
      expect(props.title).toBe(NOT_SET);
      expect(props.description).toBe(NOT_SET);
      expect(props.startDate).toBe(NOT_SET);
      expect(props.startTime).toBe(NOT_SET);
      expect(props.locationName).toBe(NOT_SET);
      expect(props.locationAddress).toBe(NOT_SET);
      expect(props.categoryName).toBe(NOT_SET);
      expect(props.featuredImageUrl).toBe(NOT_SET);
      expect(props.registerUrl).toBe(NOT_SET);
    });
  });

  describe('isMissing helper', () => {
    it('returns true for NOT_SET sentinel', () => {
      expect(isMissing(NOT_SET)).toBe(true);
    });

    it('returns false for empty string, null, undefined, real values', () => {
      expect(isMissing('')).toBe(false);
      expect(isMissing(null)).toBe(false);
      expect(isMissing(undefined)).toBe(false);
      expect(isMissing('Hello')).toBe(false);
      expect(isMissing(0)).toBe(false);
      expect(isMissing(false)).toBe(false);
    });
  });

  describe('collectGaps', () => {
    it('lists every NOT_SET field as a gap on a fully empty event', () => {
      const props = toMecProps({});
      const gaps = collectGaps(props);
      const labels = gaps.map(g => g.label);

      // Fields with no app-side counterpart (Tier B work)
      expect(labels).toContain('Featured image');
      expect(labels).toContain('Register URL');

      // Fields that exist in the app but happen to be empty
      expect(labels).toContain('Title');
      expect(labels).toContain('Description');
      expect(labels).toContain('Date');
      expect(labels).toContain('Time');
      expect(labels).toContain('Location');
      expect(labels).toContain('Category');
    });

    it('tags featuredImage and registerUrl as empty (user can fill them in the Web Page tab)', () => {
      const props = toMecProps({});
      const gaps = collectGaps(props);
      const featured = gaps.find(g => g.label === 'Featured image');
      const register = gaps.find(g => g.label === 'Register URL');
      expect(featured.kind).toBe('empty');
      expect(register.kind).toBe('empty');
    });

    it('tags onsite venue street address gap as no-field (the app has no field for it)', () => {
      const props = toMecProps({
        isOffsite: false,
        locationDisplayNames: ['Temple Emanu-El'],
      });
      const gaps = collectGaps(props);
      const addr = gaps.find(g => g.label === 'Venue street address');
      expect(addr.kind).toBe('no-field');
    });

    it('tags app-side empties as empty', () => {
      const props = toMecProps({});
      const gaps = collectGaps(props);
      const title = gaps.find(g => g.label === 'Title');
      expect(title.kind).toBe('empty');
    });

    it('reports venue street address gap only when location name is set but address is not', () => {
      // Onsite: name set (Temple Emanu-El) but address always NOT_SET in v1
      const onsite = toMecProps({
        isOffsite: false,
        locationDisplayNames: ['Temple Emanu-El'],
      });
      const onsiteGaps = collectGaps(onsite);
      expect(onsiteGaps.find(g => g.label === 'Venue street address')).toBeTruthy();
    });

    it('does NOT report street address gap when location name itself is missing', () => {
      const noLoc = toMecProps({});
      const gaps = collectGaps(noLoc);
      // Location is itself missing — so address gap is suppressed
      expect(gaps.find(g => g.label === 'Venue street address')).toBeFalsy();
      // But Location should appear as a regular gap
      expect(gaps.find(g => g.label === 'Location')).toBeTruthy();
    });

    it('does NOT report street address gap when offsite event has both name and address', () => {
      const props = toMecProps({
        isOffsite: true,
        offsiteName: 'Carnegie Hall',
        offsiteAddress: '881 7th Ave',
      });
      const gaps = collectGaps(props);
      expect(gaps.find(g => g.label === 'Venue street address')).toBeFalsy();
    });

    it('produces gaps in a stable, predictable order', () => {
      const props = toMecProps({});
      const labels = collectGaps(props).map(g => g.label);
      const featuredIdx = labels.indexOf('Featured image');
      const registerIdx = labels.indexOf('Register URL');
      const titleIdx = labels.indexOf('Title');
      // Featured + Register come before app-side gaps in the listed order.
      expect(featuredIdx).toBeLessThan(titleIdx);
      expect(registerIdx).toBeLessThan(titleIdx);
    });

    it('returns minimal gaps when all app fields are filled', () => {
      const props = toMecProps({
        eventTitle: 'Class',
        eventDescription: 'Weekly class',
        startDate: '2026-05-14',
        startTime: '09:30',
        isOffsite: false,
        locationDisplayNames: ['Temple Emanu-El'],
        categories: ['Music'],
      });
      const gaps = collectGaps(props);
      const labels = gaps.map(g => g.label);
      // Expected remaining gaps: featured image, register url, venue street address
      expect(labels).toEqual(expect.arrayContaining(['Featured image', 'Register URL', 'Venue street address']));
      // App-side fields should not appear as gaps
      expect(labels).not.toContain('Title');
      expect(labels).not.toContain('Description');
      expect(labels).not.toContain('Date');
      expect(labels).not.toContain('Time');
      expect(labels).not.toContain('Location');
      expect(labels).not.toContain('Category');
    });
  });
});
