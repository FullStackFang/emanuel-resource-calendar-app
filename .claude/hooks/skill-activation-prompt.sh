#!/bin/bash
# Skill Activation Prompt Hook (UserPromptSubmit)
# Matches user prompts against skill-rules.json and outputs recommendations
# that Claude sees in its conversation context.
set -e
cd "$CLAUDE_PROJECT_DIR/.claude/hooks"
cat | node skill-activation-prompt.js
