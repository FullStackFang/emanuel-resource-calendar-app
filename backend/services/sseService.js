// backend/services/sseService.js
/**
 * Server-Sent Events (SSE) client manager singleton.
 *
 * Handles ticket-based authentication, client connection lifecycle,
 * event broadcasting, heartbeat keep-alive, and missed-event replay.
 * No database dependency — everything is in-memory.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// ── Configuration ──
const TICKET_TTL_MS = 30_000;        // Tickets expire after 30 seconds
const TICKET_CLEANUP_INTERVAL = 60_000; // Clean expired tickets every 60s
const HEARTBEAT_INTERVAL = 25_000;    // Send heartbeat every 25s (Azure idle timeout is 230s)
const EVENT_HISTORY_SIZE = 100;       // Ring buffer size for replay

class SSEService {
  constructor() {
    this.clients = new Set();         // Set<{ res, userId, email, connectedAt }>
    this.ticketStore = new Map();     // Map<ticketId, { userId, email, role, createdAt }>
    this.eventHistory = [];           // Ring buffer of recent events for replay
    this.nextEventId = 1;             // Monotonic counter for SSE event IDs
    this._heartbeatTimer = null;
    this._cleanupTimer = null;
  }

  /**
   * Start background timers (heartbeat + ticket cleanup).
   * Call once after server starts listening.
   */
  start() {
    if (this._heartbeatTimer) return; // Already started

    this._heartbeatTimer = setInterval(() => this._sendHeartbeats(), HEARTBEAT_INTERVAL);
    this._cleanupTimer = setInterval(() => this._cleanupExpiredTickets(), TICKET_CLEANUP_INTERVAL);

    // Don't block process exit
    this._heartbeatTimer.unref();
    this._cleanupTimer.unref();

    logger.log('[SSE] Service started — heartbeat every %dms, ticket cleanup every %dms',
      HEARTBEAT_INTERVAL, TICKET_CLEANUP_INTERVAL);
  }

  /**
   * Stop background timers and close all clients.
   * Call during graceful shutdown.
   */
  stop() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.closeAllClients();
    logger.log('[SSE] Service stopped');
  }

  // ── Ticket management ──

  /**
   * Create a single-use, short-lived SSE ticket.
   * The frontend exchanges a JWT for this ticket, then uses it to open the EventSource.
   */
  createTicket(userId, email, role) {
    const ticketId = crypto.randomUUID();
    this.ticketStore.set(ticketId, {
      userId,
      email,
      role,
      createdAt: Date.now()
    });
    return ticketId;
  }

  /**
   * Consume a ticket (single-use). Returns user info or null if invalid/expired.
   */
  consumeTicket(ticketId) {
    const ticket = this.ticketStore.get(ticketId);
    if (!ticket) return null;

    // Always delete — single use
    this.ticketStore.delete(ticketId);

    // Check expiration
    if (Date.now() - ticket.createdAt > TICKET_TTL_MS) {
      return null;
    }

    return { userId: ticket.userId, email: ticket.email, role: ticket.role };
  }

  // ── Client management ──

  /**
   * Register a new SSE client connection.
   */
  addClient(res, userId, email) {
    const client = { res, userId, email, connectedAt: Date.now() };
    this.clients.add(client);
    logger.log('[SSE] Client connected: %s (%d total)', email, this.clients.size);
    return client;
  }

  /**
   * Remove a client connection (called on req 'close' event).
   */
  removeClient(client) {
    this.clients.delete(client);
    logger.log('[SSE] Client disconnected: %s (%d remaining)', client.email, this.clients.size);
  }

  /**
   * Close all client connections gracefully.
   */
  closeAllClients() {
    for (const client of this.clients) {
      try {
        client.res.write('event: shutdown\ndata: {}\n\n');
        client.res.end();
      } catch {
        // Client may already be disconnected
      }
    }
    this.clients.clear();
  }

  // ── Broadcasting ──

  /**
   * Broadcast an event to all connected clients.
   * @param {Object} payload - Event data (eventId, action, affectedViews, etc.)
   */
  broadcast(payload) {
    const eventId = this.nextEventId++;

    // Store in ring buffer for replay
    const entry = { id: eventId, payload, timestamp: Date.now() };
    this.eventHistory.push(entry);
    if (this.eventHistory.length > EVENT_HISTORY_SIZE) {
      this.eventHistory.shift();
    }

    // Format as SSE
    const message = `event: event-changed\nid: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`;

    let sent = 0;
    for (const client of this.clients) {
      try {
        client.res.write(message);
        // Flush if compression middleware buffered it
        if (typeof client.res.flush === 'function') {
          client.res.flush();
        }
        sent++;
      } catch (err) {
        logger.warn('[SSE] Failed to write to client %s: %s', client.email, err.message);
        // Client will be cleaned up when the 'close' event fires
      }
    }

    logger.log('[SSE] Broadcast event #%d (%s) to %d/%d clients',
      eventId, payload.action, sent, this.clients.size);
  }

  /**
   * Get events since a given event ID (for replay after reconnect).
   * @param {number} lastEventId - The last event ID the client received
   * @returns {Array} Events the client missed
   */
  getEventsSince(lastEventId) {
    if (!lastEventId || lastEventId <= 0) return [];
    return this.eventHistory.filter(e => e.id > lastEventId);
  }

  // ── Stats ──

  getStats() {
    return {
      connectedClients: this.clients.size,
      activeTickets: this.ticketStore.size,
      nextEventId: this.nextEventId,
      eventHistorySize: this.eventHistory.length
    };
  }

  // ── Internal ──

  _sendHeartbeats() {
    const now = Date.now();
    for (const client of this.clients) {
      try {
        client.res.write(`: heartbeat ${now}\n\n`);
        if (typeof client.res.flush === 'function') {
          client.res.flush();
        }
      } catch {
        // Client will be cleaned up on 'close'
      }
    }
  }

  _cleanupExpiredTickets() {
    const now = Date.now();
    let cleaned = 0;
    for (const [ticketId, ticket] of this.ticketStore) {
      if (now - ticket.createdAt > TICKET_TTL_MS) {
        this.ticketStore.delete(ticketId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.log('[SSE] Cleaned %d expired tickets (%d remaining)', cleaned, this.ticketStore.size);
    }
  }
}

// Export singleton
module.exports = new SSEService();
