/**
 * Tests for eventPayloadBuilder.js — virtual meeting URL plumbing.
 *
 * Regression guard for the bug where a user-entered virtual meeting URL
 * (the 🎥 Virtual popover in RoomReservationFormBase) was silently dropped
 * before reaching the backend. Every write-path payload builder must forward
 * `virtualMeetingUrl`. The platform name is DERIVED on the backend from the
 * URL (see eventFieldBuilder.buildEventFields), so it is intentionally not
 * carried in these payloads.
 */

import { describe, it, expect } from 'vitest';
import {
  buildInternalFields,
  buildRequesterPayload,
  buildDraftPayload,
  buildOwnerEditPayload,
  buildEditRequestPayload,
} from '../../../utils/eventPayloadBuilder';

const VIRTUAL_URL = 'https://zoom.us/j/123456789';

describe('eventPayloadBuilder — virtualMeetingUrl plumbing', () => {
  it('buildInternalFields forwards virtualMeetingUrl (unified-form audit-update path)', () => {
    expect(buildInternalFields({ virtualMeetingUrl: VIRTUAL_URL }).virtualMeetingUrl).toBe(VIRTUAL_URL);
  });

  it('buildInternalFields defaults virtualMeetingUrl to null when absent', () => {
    expect(buildInternalFields({}).virtualMeetingUrl).toBe(null);
  });

  it('buildRequesterPayload forwards virtualMeetingUrl (POST /api/events/request)', () => {
    expect(buildRequesterPayload({ virtualMeetingUrl: VIRTUAL_URL }, {}).virtualMeetingUrl).toBe(VIRTUAL_URL);
  });

  it('buildDraftPayload forwards virtualMeetingUrl', () => {
    expect(buildDraftPayload({ virtualMeetingUrl: VIRTUAL_URL }).virtualMeetingUrl).toBe(VIRTUAL_URL);
  });

  it('buildOwnerEditPayload forwards virtualMeetingUrl', () => {
    expect(buildOwnerEditPayload({ virtualMeetingUrl: VIRTUAL_URL }, { eventVersion: 1 }).virtualMeetingUrl).toBe(VIRTUAL_URL);
  });

  it('buildEditRequestPayload forwards virtualMeetingUrl', () => {
    expect(buildEditRequestPayload({ virtualMeetingUrl: VIRTUAL_URL }, { eventVersion: 1 }).virtualMeetingUrl).toBe(VIRTUAL_URL);
  });
});
