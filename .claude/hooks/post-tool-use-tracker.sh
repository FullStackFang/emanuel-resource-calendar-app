#!/bin/bash
# Post-Tool-Use Tracker Hook (PostToolUse)
# Tracks file edits by area (frontend/backend/tests) per session.
# Creates a session-scoped cache in .claude/.cache/<session_id>/.
set -e
cd "$CLAUDE_PROJECT_DIR/.claude/hooks"
cat | node post-tool-use-tracker.js
