/**
 * SSE Service Unit Tests
 *
 * Tests ticket lifecycle, client management, broadcasting,
 * event replay, and cleanup timers.
 */

const sseService = require('../../../services/sseService');

// Mock response objects for SSE clients
function createMockRes() {
  const written = [];
  return {
    write: jest.fn((data) => written.push(data)),
    flush: jest.fn(),
    end: jest.fn(),
    _written: written
  };
}

describe('SSE Service', () => {
  beforeEach(() => {
    // Reset service state between tests
    sseService.clients.clear();
    sseService.ticketStore.clear();
    sseService.eventHistory = [];
    sseService.nextEventId = 1;
  });

  afterAll(() => {
    sseService.stop();
  });

  // ── Ticket Management ──

  describe('Ticket Management', () => {
    test('SSE-T1: createTicket returns a UUID string', () => {
      const ticket = sseService.createTicket('user1', 'user@test.com', 'admin');
      expect(ticket).toBeDefined();
      expect(typeof ticket).toBe('string');
      expect(ticket.length).toBeGreaterThan(0);
    });

    test('SSE-T2: consumeTicket returns user info and deletes ticket (single-use)', () => {
      const ticket = sseService.createTicket('user1', 'user@test.com', 'approver');

      // First consume succeeds
      const user = sseService.consumeTicket(ticket);
      expect(user).toEqual({ userId: 'user1', email: 'user@test.com', role: 'approver' });

      // Second consume fails (single-use)
      const secondAttempt = sseService.consumeTicket(ticket);
      expect(secondAttempt).toBeNull();
    });

    test('SSE-T3: consumeTicket returns null for non-existent ticket', () => {
      const result = sseService.consumeTicket('non-existent-ticket-id');
      expect(result).toBeNull();
    });

    test('SSE-T4: consumeTicket returns null for expired ticket', () => {
      const ticket = sseService.createTicket('user1', 'user@test.com', 'admin');

      // Manually expire the ticket
      const ticketData = sseService.ticketStore.get(ticket);
      ticketData.createdAt = Date.now() - 60_000; // 60 seconds ago (TTL is 30s)

      const result = sseService.consumeTicket(ticket);
      expect(result).toBeNull();
    });

    test('SSE-T5: _cleanupExpiredTickets removes old tickets', () => {
      const ticket1 = sseService.createTicket('user1', 'a@test.com', 'admin');
      const ticket2 = sseService.createTicket('user2', 'b@test.com', 'requester');

      // Expire ticket1
      sseService.ticketStore.get(ticket1).createdAt = Date.now() - 60_000;

      expect(sseService.ticketStore.size).toBe(2);
      sseService._cleanupExpiredTickets();
      expect(sseService.ticketStore.size).toBe(1);
      expect(sseService.ticketStore.has(ticket2)).toBe(true);
    });
  });

  // ── Client Management ──

  describe('Client Management', () => {
    test('SSE-C1: addClient registers a client and returns client object', () => {
      const res = createMockRes();
      const client = sseService.addClient(res, 'user1', 'user@test.com');

      expect(client.res).toBe(res);
      expect(client.userId).toBe('user1');
      expect(client.email).toBe('user@test.com');
      expect(client.connectedAt).toBeDefined();
      expect(sseService.clients.size).toBe(1);
    });

    test('SSE-C2: removeClient unregisters a client', () => {
      const res = createMockRes();
      const client = sseService.addClient(res, 'user1', 'user@test.com');
      expect(sseService.clients.size).toBe(1);

      sseService.removeClient(client);
      expect(sseService.clients.size).toBe(0);
    });

    test('SSE-C3: closeAllClients sends shutdown event and clears all', () => {
      const res1 = createMockRes();
      const res2 = createMockRes();
      sseService.addClient(res1, 'user1', 'a@test.com');
      sseService.addClient(res2, 'user2', 'b@test.com');
      expect(sseService.clients.size).toBe(2);

      sseService.closeAllClients();

      expect(sseService.clients.size).toBe(0);
      expect(res1.write).toHaveBeenCalledWith('event: shutdown\ndata: {}\n\n');
      expect(res1.end).toHaveBeenCalled();
      expect(res2.write).toHaveBeenCalledWith('event: shutdown\ndata: {}\n\n');
      expect(res2.end).toHaveBeenCalled();
    });
  });

  // ── Broadcasting ──

  describe('Broadcasting', () => {
    test('SSE-B1: broadcast sends SSE-formatted message to all clients', () => {
      const res1 = createMockRes();
      const res2 = createMockRes();
      sseService.addClient(res1, 'user1', 'a@test.com');
      sseService.addClient(res2, 'user2', 'b@test.com');

      const payload = {
        eventId: 'abc123',
        action: 'published',
        actorEmail: 'admin@test.com',
        affectedViews: ['calendar', 'approval-queue'],
        countsChanged: true,
        timestamp: Date.now()
      };

      sseService.broadcast(payload);

      // Both clients should receive the message
      expect(res1.write).toHaveBeenCalledTimes(1);
      expect(res2.write).toHaveBeenCalledTimes(1);

      // Verify SSE format
      const sentData = res1.write.mock.calls[0][0];
      expect(sentData).toContain('event: event-changed');
      expect(sentData).toContain('id: 1');
      expect(sentData).toContain(`data: ${JSON.stringify(payload)}`);
      expect(sentData.endsWith('\n\n')).toBe(true);
    });

    test('SSE-B2: broadcast increments event ID monotonically', () => {
      const res = createMockRes();
      sseService.addClient(res, 'user1', 'a@test.com');

      sseService.broadcast({ action: 'created' });
      sseService.broadcast({ action: 'updated' });
      sseService.broadcast({ action: 'deleted' });

      const ids = res.write.mock.calls.map(call => {
        const match = call[0].match(/id: (\d+)/);
        return match ? parseInt(match[1]) : null;
      });

      expect(ids).toEqual([1, 2, 3]);
    });

    test('SSE-B3: broadcast stores events in ring buffer', () => {
      sseService.broadcast({ action: 'created' });
      sseService.broadcast({ action: 'published' });

      expect(sseService.eventHistory.length).toBe(2);
      expect(sseService.eventHistory[0].id).toBe(1);
      expect(sseService.eventHistory[1].id).toBe(2);
    });

    test('SSE-B4: broadcast handles client write errors gracefully', () => {
      const badRes = createMockRes();
      badRes.write = jest.fn(() => { throw new Error('Connection reset'); });
      const goodRes = createMockRes();

      sseService.addClient(badRes, 'bad', 'bad@test.com');
      sseService.addClient(goodRes, 'good', 'good@test.com');

      // Should not throw
      expect(() => sseService.broadcast({ action: 'created' })).not.toThrow();

      // Good client still received the message
      expect(goodRes.write).toHaveBeenCalledTimes(1);
    });

    test('SSE-B5: broadcast with no clients does not throw', () => {
      expect(() => sseService.broadcast({ action: 'created' })).not.toThrow();
      expect(sseService.eventHistory.length).toBe(1);
    });
  });

  // ── Event Replay ──

  describe('Event Replay', () => {
    test('SSE-R1: getEventsSince returns events after given ID', () => {
      sseService.broadcast({ action: 'created' });   // id: 1
      sseService.broadcast({ action: 'published' });  // id: 2
      sseService.broadcast({ action: 'deleted' });    // id: 3

      const missed = sseService.getEventsSince(1);
      expect(missed.length).toBe(2);
      expect(missed[0].id).toBe(2);
      expect(missed[1].id).toBe(3);
    });

    test('SSE-R2: getEventsSince with 0 returns empty array', () => {
      sseService.broadcast({ action: 'created' });
      const missed = sseService.getEventsSince(0);
      expect(missed).toEqual([]);
    });

    test('SSE-R3: getEventsSince with null returns empty array', () => {
      sseService.broadcast({ action: 'created' });
      const missed = sseService.getEventsSince(null);
      expect(missed).toEqual([]);
    });

    test('SSE-R4: ring buffer caps at 100 events', () => {
      for (let i = 0; i < 120; i++) {
        sseService.broadcast({ action: 'created', index: i });
      }

      expect(sseService.eventHistory.length).toBe(100);
      // First 20 events should have been evicted
      expect(sseService.eventHistory[0].id).toBe(21);
    });
  });

  // ── Stats ──

  describe('Stats', () => {
    test('SSE-S1: getStats returns current service state', () => {
      const res = createMockRes();
      sseService.addClient(res, 'user1', 'a@test.com');
      sseService.createTicket('user2', 'b@test.com', 'admin');
      sseService.broadcast({ action: 'created' });

      const stats = sseService.getStats();
      expect(stats.connectedClients).toBe(1);
      expect(stats.activeTickets).toBe(1);
      expect(stats.nextEventId).toBe(2);
      expect(stats.eventHistorySize).toBe(1);
    });
  });

  // ── Heartbeat ──

  describe('Heartbeat', () => {
    test('SSE-H1: _sendHeartbeats writes comment to all clients', () => {
      const res1 = createMockRes();
      const res2 = createMockRes();
      sseService.addClient(res1, 'user1', 'a@test.com');
      sseService.addClient(res2, 'user2', 'b@test.com');

      sseService._sendHeartbeats();

      expect(res1.write).toHaveBeenCalledTimes(1);
      expect(res2.write).toHaveBeenCalledTimes(1);
      // Heartbeat uses SSE comment format
      expect(res1.write.mock.calls[0][0]).toMatch(/^: heartbeat \d+\n\n$/);
    });
  });
});
