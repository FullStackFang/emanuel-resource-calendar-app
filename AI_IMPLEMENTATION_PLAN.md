# AI Integration Implementation Plan

This document outlines the proposed architecture for adding AI-powered features to the Emanuel Resource Calendar application, including an MCP (Model Context Protocol) wrapper around the API and a chat interface.

## Overview

The AI integration will enable:
- Natural language interaction with the calendar system
- Intelligent event scheduling suggestions
- Automated conflict detection and resolution
- Smart search and filtering
- Learning user preferences over time

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Calendar Views │  │   Chat Panel    │  │  AI Suggestions │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js/Express)                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Existing API   │  │ AI Orchestrator │  │   MCP Server    │  │
│  │   Endpoints     │◄─┤    (Claude)     │◄─┤   (Tools)       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
           ┌───────────────┐         ┌───────────────┐
           │  Claude API   │         │   MongoDB     │
           │  (Anthropic)  │         │  (Learning)   │
           └───────────────┘         └───────────────┘
```

### New Components

#### 1. MCP Server (`backend/services/mcpServer.js`)

Exposes calendar operations as tools for the AI:

```javascript
// Tool definitions for MCP
const calendarTools = [
  {
    name: 'search_events',
    description: 'Search for events by date range, category, location, or text',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date string' },
        endDate: { type: 'string', description: 'ISO date string' },
        query: { type: 'string', description: 'Search text' },
        category: { type: 'string', description: 'Event category' },
        location: { type: 'string', description: 'Location name' }
      }
    }
  },
  {
    name: 'check_availability',
    description: 'Check room/resource availability for a time slot',
    input_schema: {
      type: 'object',
      properties: {
        locationId: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        date: { type: 'string' }
      },
      required: ['startTime', 'endTime', 'date']
    }
  },
  {
    name: 'get_event_details',
    description: 'Get full details of a specific event',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' }
      },
      required: ['eventId']
    }
  },
  {
    name: 'list_locations',
    description: 'List available rooms and locations with their features',
    input_schema: {
      type: 'object',
      properties: {
        features: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required features (kitchen, av_equipment, etc.)'
        },
        minCapacity: { type: 'number' }
      }
    }
  },
  {
    name: 'suggest_times',
    description: 'Find available time slots for an event',
    input_schema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Duration in minutes' },
        preferredDate: { type: 'string' },
        locationId: { type: 'string' },
        flexibility: { type: 'number', description: 'Days to search before/after' }
      },
      required: ['duration']
    }
  },
  {
    name: 'create_reservation_draft',
    description: 'Create a draft reservation request for user review',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        locationId: { type: 'string' },
        description: { type: 'string' },
        attendeeCount: { type: 'number' }
      },
      required: ['title', 'startTime', 'endTime']
    }
  }
];
```

#### 2. AI Orchestrator (`backend/services/aiOrchestrator.js`)

Manages conversation context and Claude API interactions:

```javascript
const Anthropic = require('@anthropic-ai/sdk');

class AIOrchestrator {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    this.conversationHistory = new Map(); // userId -> messages[]
  }

  async processMessage(userId, userMessage, userContext) {
    // Build system prompt with user context
    const systemPrompt = this.buildSystemPrompt(userContext);

    // Get or initialize conversation history
    const history = this.getConversationHistory(userId);

    // Add user message
    history.push({ role: 'user', content: userMessage });

    // Call Claude with tools
    const response = await this.client.messages.create({
      model: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      tools: calendarTools,
      messages: history
    });

    // Process tool calls if any
    if (response.stop_reason === 'tool_use') {
      return await this.handleToolCalls(userId, response, history);
    }

    // Extract text response
    const assistantMessage = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Save to history
    history.push({ role: 'assistant', content: response.content });
    this.saveConversationHistory(userId, history);

    return { message: assistantMessage, suggestions: [] };
  }

  buildSystemPrompt(userContext) {
    return `You are an AI assistant for the Temple Emanuel calendar system.
You help users find events, check availability, and manage reservations.

Current user: ${userContext.name} (${userContext.email})
User role: ${userContext.role}
Current date/time: ${new Date().toISOString()}
User timezone: ${userContext.timezone || 'America/New_York'}

Guidelines:
- Be concise and helpful
- When searching for events, confirm the date range with the user if not specified
- Always verify availability before suggesting times
- For reservations, create drafts for user review - never auto-submit
- Respect the user's role permissions
- Use friendly, professional language appropriate for a synagogue community`;
  }

  async handleToolCalls(userId, response, history) {
    // Execute each tool call
    const toolResults = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await this.executeTool(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }
    }

    // Add assistant response and tool results to history
    history.push({ role: 'assistant', content: response.content });
    history.push({ role: 'user', content: toolResults });

    // Continue conversation with tool results
    const followUp = await this.client.messages.create({
      model: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      tools: calendarTools,
      messages: history
    });

    // Recursively handle if more tool calls needed
    if (followUp.stop_reason === 'tool_use') {
      return await this.handleToolCalls(userId, followUp, history);
    }

    const assistantMessage = followUp.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    history.push({ role: 'assistant', content: followUp.content });
    this.saveConversationHistory(userId, history);

    return { message: assistantMessage };
  }

  async executeTool(toolName, input) {
    // Route to appropriate service
    switch (toolName) {
      case 'search_events':
        return await calendarService.searchEvents(input);
      case 'check_availability':
        return await calendarService.checkAvailability(input);
      case 'get_event_details':
        return await calendarService.getEventDetails(input.eventId);
      case 'list_locations':
        return await locationService.listLocations(input);
      case 'suggest_times':
        return await calendarService.suggestTimes(input);
      case 'create_reservation_draft':
        return await reservationService.createDraft(input);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }
}
```

#### 3. Chat API Endpoints (`backend/api-server.js`)

```javascript
// POST /api/ai/chat - Send message to AI
app.post('/api/ai/chat', authenticateToken, async (req, res) => {
  const { message, conversationId } = req.body;
  const userId = req.user.oid;

  const userContext = {
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    timezone: req.user.timezone
  };

  const response = await aiOrchestrator.processMessage(
    conversationId || userId,
    message,
    userContext
  );

  res.json(response);
});

// GET /api/ai/conversations - Get conversation history
app.get('/api/ai/conversations', authenticateToken, async (req, res) => {
  const userId = req.user.oid;
  const conversations = await aiOrchestrator.getConversations(userId);
  res.json(conversations);
});

// DELETE /api/ai/conversations/:id - Clear conversation
app.delete('/api/ai/conversations/:id', authenticateToken, async (req, res) => {
  await aiOrchestrator.clearConversation(req.params.id);
  res.json({ success: true });
});
```

#### 4. Chat UI Component (`src/components/AIChat.jsx`)

```jsx
import React, { useState, useRef, useEffect } from 'react';
import {
  Panel, TextField, Button, Spinner,
  Stack, Text, IconButton
} from '@fluentui/react';

export function AIChat({ isOpen, onDismiss }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: userMessage })
      });

      const data = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        suggestions: data.suggestions
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Panel
      isOpen={isOpen}
      onDismiss={onDismiss}
      headerText="Calendar Assistant"
      isLightDismiss
    >
      <Stack tokens={{ childrenGap: 10 }} styles={{ root: { height: '100%' } }}>
        {/* Message History */}
        <div className="chat-messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <Text>{msg.content}</Text>
              {msg.suggestions?.length > 0 && (
                <Stack horizontal tokens={{ childrenGap: 5 }}>
                  {msg.suggestions.map((s, i) => (
                    <Button key={i} text={s.label} onClick={() => setInput(s.query)} />
                  ))}
                </Stack>
              )}
            </div>
          ))}
          {isLoading && <Spinner label="Thinking..." />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <Stack horizontal tokens={{ childrenGap: 10 }}>
          <TextField
            value={input}
            onChange={(e, val) => setInput(val)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about events, availability, or reservations..."
            styles={{ root: { flexGrow: 1 } }}
          />
          <IconButton
            iconProps={{ iconName: 'Send' }}
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
          />
        </Stack>
      </Stack>
    </Panel>
  );
}
```

### Learning Service (Optional Enhancement)

Store user interactions to improve suggestions over time:

```javascript
// backend/services/aiLearningService.js
class AILearningService {
  constructor(db) {
    this.collection = db.collection('templeEvents__AILearning');
  }

  async recordInteraction(userId, interaction) {
    await this.collection.insertOne({
      userId,
      timestamp: new Date(),
      query: interaction.query,
      toolsUsed: interaction.toolsUsed,
      successful: interaction.successful,
      feedback: interaction.feedback
    });
  }

  async getUserPatterns(userId) {
    // Analyze past interactions to personalize responses
    const interactions = await this.collection
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    return {
      frequentSearches: this.extractFrequentSearches(interactions),
      preferredLocations: this.extractPreferredLocations(interactions),
      typicalEventTimes: this.extractTypicalTimes(interactions)
    };
  }
}
```

## Cost Structure

### Claude API Pricing (as of January 2025)

| Model | Input Tokens | Output Tokens | Best For |
|-------|-------------|---------------|----------|
| Claude 3.5 Sonnet | $3.00 / 1M tokens | $15.00 / 1M tokens | Production use |
| Claude 3.5 Haiku | $0.25 / 1M tokens | $1.25 / 1M tokens | Development/testing |
| Claude 3 Opus | $15.00 / 1M tokens | $75.00 / 1M tokens | Complex reasoning |

### Token Usage Estimates

**Typical Chat Interaction:**
- System prompt: ~300 tokens
- User message: ~50-200 tokens
- Context/history: ~200-1,000 tokens
- Tool calls: ~100-500 tokens per tool
- Assistant response: ~200-1,000 tokens

**Per Interaction Estimates:**

| Complexity | Input Tokens | Output Tokens | Sonnet Cost | Haiku Cost |
|------------|-------------|---------------|-------------|------------|
| Simple query | 500 | 200 | $0.0045 | $0.0004 |
| Search + response | 1,000 | 500 | $0.0105 | $0.0009 |
| Multi-tool interaction | 2,000 | 800 | $0.0180 | $0.0015 |
| Complex planning | 3,000 | 1,500 | $0.0315 | $0.0026 |

### Testing Budget Estimates

| Phase | Interactions | Sonnet Cost | Haiku Cost |
|-------|--------------|-------------|------------|
| Initial development | 50 | $0.50 - $1.00 | $0.05 - $0.10 |
| Feature testing | 200 | $2.00 - $4.00 | $0.20 - $0.40 |
| Integration testing | 500 | $5.00 - $10.00 | $0.50 - $1.00 |
| User acceptance testing | 1,000 | $10.00 - $20.00 | $1.00 - $2.00 |
| **Total Development** | ~1,750 | **$17.50 - $35.00** | **$1.75 - $3.50** |

### Production Cost Estimates

**Per User Per Month (assuming 20 interactions):**
- Sonnet: $0.20 - $0.40 / user / month
- Haiku: $0.02 - $0.04 / user / month

**Monthly Estimates by User Count:**

| Active Users | Sonnet Monthly | Haiku Monthly |
|--------------|----------------|---------------|
| 10 users | $2 - $4 | $0.20 - $0.40 |
| 50 users | $10 - $20 | $1 - $2 |
| 100 users | $20 - $40 | $2 - $4 |
| 500 users | $100 - $200 | $10 - $20 |

### Cost Optimization Strategies

1. **Use Haiku for development and simple queries**
   - Configure model selection based on query complexity
   - Default to Haiku, escalate to Sonnet for complex tasks

2. **Implement response caching**
   - Cache frequent queries (e.g., "What events are today?")
   - TTL-based invalidation when calendar changes

3. **Limit conversation history**
   - Keep only last 5-10 messages in context
   - Summarize older context to reduce tokens

4. **Set usage limits**
   - Daily/monthly token caps per user
   - Rate limiting on chat endpoint

5. **Optimize system prompts**
   - Keep prompts concise
   - Load context only when needed

## Environment Variables

Add to `.env`:

```bash
# AI Configuration
ANTHROPIC_API_KEY=sk-ant-xxxxx
AI_MODEL=claude-3-5-sonnet-20241022  # or claude-3-5-haiku-20241022 for dev
AI_MAX_TOKENS=1024
AI_ENABLED=true

# Cost Controls
AI_DAILY_TOKEN_LIMIT=100000
AI_USER_RATE_LIMIT=20  # requests per hour
```

## Implementation Phases

### Phase 1: Foundation (Backend)
- [ ] Set up Anthropic SDK integration
- [ ] Create MCP tool definitions
- [ ] Implement AI orchestrator service
- [ ] Add chat API endpoints
- [ ] Basic error handling and logging

### Phase 2: Core Features (Full Stack)
- [ ] Chat UI component
- [ ] Event search via AI
- [ ] Availability checking
- [ ] Location recommendations

### Phase 3: Advanced Features
- [ ] Reservation draft creation
- [ ] Smart scheduling suggestions
- [ ] Conflict resolution assistance
- [ ] Learning service integration

### Phase 4: Polish
- [ ] Conversation history persistence
- [ ] User feedback collection
- [ ] Cost monitoring dashboard
- [ ] Performance optimization

## Security Considerations

1. **API Key Protection**
   - Store in environment variables only
   - Never expose to frontend

2. **Input Validation**
   - Sanitize user messages before sending to AI
   - Validate tool inputs

3. **Permission Enforcement**
   - Check user role before executing tools
   - AI cannot bypass existing permission system

4. **Rate Limiting**
   - Per-user rate limits
   - Global token budget limits

5. **Data Privacy**
   - Don't include sensitive data in AI context
   - Clear conversation history option
   - No PII in logs

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  }
}
```

## References

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Claude Tool Use Guide](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [MCP Specification](https://modelcontextprotocol.io/)
- [Anthropic Pricing](https://www.anthropic.com/pricing)
