// src/components/AIChat.jsx
// Step 1: Basic chat panel - no tools, no learning
import React, { useState, useRef, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import './AIChat.css';

export default function AIChat({ isOpen, onClose, apiToken }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch model info on open
  useEffect(() => {
    if (isOpen && apiToken && !model) {
      fetch(`${APP_CONFIG.API_BASE_URL}/ai/status`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      })
        .then(res => res.json())
        .then(data => setModel(data.model))
        .catch(() => {});
    }
  }, [isOpen, apiToken, model]);

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
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message || data.error || 'No response'
      }]);
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
