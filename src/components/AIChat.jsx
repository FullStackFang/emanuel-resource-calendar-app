// src/components/AIChat.jsx
// AI Chat panel with MCP tools for calendar assistance
import React, { useState, useRef, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { dispatchRefresh } from '../hooks/useDataRefreshBus';
import './AIChat.css';

export default function AIChat({ isOpen, onClose, apiToken, onCalendarRefresh }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change or chat opens
  useEffect(() => {
    if (isOpen) {
      // Use setTimeout to ensure DOM is rendered before scrolling
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, isOpen]);

  // Fetch model info and conversation history on open
  useEffect(() => {
    if (isOpen && apiToken) {
      // Fetch model info
      if (!model) {
        fetch(`${APP_CONFIG.API_BASE_URL}/ai/status`, {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        })
          .then(res => res.json())
          .then(data => setModel(data.model))
          .catch(() => {});
      }

      // Fetch conversation history (only if messages are empty)
      if (messages.length === 0) {
        fetch(`${APP_CONFIG.API_BASE_URL}/ai/chat/history`, {
          headers: { 'Authorization': `Bearer ${apiToken}` }
        })
          .then(res => res.json())
          .then(data => {
            if (data.messages && data.messages.length > 0) {
              setMessages(data.messages);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, apiToken, model, messages.length]);

  if (!isOpen) return null;

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch(`${APP_CONFIG.API_BASE_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();

      // Check if this is a reservation form request
      if (data.openReservationForm && data.formData) {
        // Show summary with form data stored in message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message || 'I\'ve prepared your reservation request.',
          type: 'reservation-summary',
          summary: data.summary,
          formData: data.formData
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message || data.error || 'No response'
        }]);
      }

      // Trigger calendar refresh if event was created
      if (data.refreshCalendar) {
        // Call callback if provided
        if (onCalendarRefresh) {
          onCalendarRefresh();
        }
        // Also dispatch custom event for any listeners
        dispatchRefresh('ai-chat');
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: ' + err.message
      }]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = async () => {
    try {
      await fetch(`${APP_CONFIG.API_BASE_URL}/ai/chat`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });
    } catch (err) {
      // Ignore errors on clear
    }
    setMessages([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="ai-chat-overlay" onClick={onClose}>
      <div className="ai-chat-panel" onClick={e => e.stopPropagation()}>
        <div className="ai-chat-header">
          <div className="ai-chat-header-title">
            <h3>Chat Assistant</h3>
            {model && <span className="ai-chat-model">{model}</span>}
          </div>
          <div className="ai-chat-header-actions">
            {messages.length > 0 && (
              <button
                className="ai-chat-clear"
                onClick={clearConversation}
                title="Clear conversation"
              >
                ↺
              </button>
            )}
            <button className="ai-chat-close" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="ai-chat-messages">
          {messages.length === 0 && (
            <div className="ai-chat-welcome">
              Ask me anything about calendars and scheduling!
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-msg-${m.role}`}>
              {m.content}
              {m.type === 'reservation-summary' && m.summary && (
                <div className="ai-chat-reservation-summary">
                  <div className="ai-chat-summary-header">Reservation Details</div>
                  <div className="ai-chat-summary-grid">
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Event:</span>
                      <span className="ai-chat-summary-value">{m.summary.title}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Location:</span>
                      <span className="ai-chat-summary-value">{m.summary.location}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Date:</span>
                      <span className="ai-chat-summary-value">{m.summary.date}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Time:</span>
                      <span className="ai-chat-summary-value">{m.summary.time}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Setup:</span>
                      <span className="ai-chat-summary-value">{m.summary.setup}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Doors Open:</span>
                      <span className="ai-chat-summary-value">{m.summary.doors}</span>
                    </div>
                    <div className="ai-chat-summary-row">
                      <span className="ai-chat-summary-label">Category:</span>
                      <span className="ai-chat-summary-value">{m.summary.category}</span>
                    </div>
                  </div>
                  {m.formData && (
                    <button
                      className="ai-chat-open-form-btn"
                      onClick={() => {
                        // Dispatch event to open reservation modal with prefilled data
                        window.dispatchEvent(new CustomEvent('ai-chat-open-reservation-modal', {
                          detail: { formData: m.formData }
                        }));
                        onClose();
                      }}
                    >
                      Review & Submit
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="ai-chat-msg ai-chat-msg-assistant">
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="ai-chat-input-area">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()} aria-label="Send">
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
