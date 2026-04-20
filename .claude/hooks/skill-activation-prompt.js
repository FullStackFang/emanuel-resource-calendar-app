#!/usr/bin/env node
'use strict';

/**
 * Skill Activation Prompt Processor
 *
 * Reads the user prompt from stdin (JSON), matches it against
 * skill-rules.json triggers, and outputs skill recommendations
 * that Claude sees in its conversation context.
 */

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').toLowerCase();

    if (!prompt || prompt.length < 3) process.exit(0);

    // Load skill rules
    const rulesPath = path.join(__dirname, '..', 'skills', 'skill-rules.json');
    if (!fs.existsSync(rulesPath)) process.exit(0);

    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    const matches = [];

    for (const [skillName, skill] of Object.entries(rules.skills)) {
      let matched = false;
      let matchReason = '';

      // Check keyword triggers
      if (skill.promptTriggers?.keywords) {
        for (const keyword of skill.promptTriggers.keywords) {
          if (prompt.includes(keyword.toLowerCase())) {
            matched = true;
            matchReason = `keyword: "${keyword}"`;
            break;
          }
        }
      }

      // Check intent patterns (regex)
      if (!matched && skill.promptTriggers?.intentPatterns) {
        for (const pattern of skill.promptTriggers.intentPatterns) {
          try {
            if (new RegExp(pattern, 'i').test(prompt)) {
              matched = true;
              matchReason = `intent: /${pattern}/`;
              break;
            }
          } catch (e) {
            // Skip invalid regex
          }
        }
      }

      if (matched) {
        matches.push({
          name: skillName,
          priority: skill.priority || 'medium',
          description: skill.description || '',
          reason: matchReason,
          enforcement: skill.enforcement || 'suggest'
        });
      }
    }

    if (matches.length === 0) process.exit(0);

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    matches.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

    // Output recommendations (Claude sees this in conversation context)
    const lines = [];
    lines.push('');
    lines.push('--------------------------------------------');
    lines.push('  SKILL ACTIVATION CHECK');
    lines.push('--------------------------------------------');

    const critical = matches.filter(m => m.priority === 'critical');
    const high = matches.filter(m => m.priority === 'high');
    const rest = matches.filter(m => !['critical', 'high'].includes(m.priority));

    if (critical.length > 0) {
      lines.push('');
      lines.push('  CRITICAL SKILLS (REQUIRED):');
      critical.forEach(m => {
        lines.push(`    -> ${m.name}  (${m.reason})`);
      });
    }

    if (high.length > 0) {
      lines.push('');
      lines.push('  RECOMMENDED SKILLS:');
      high.forEach(m => {
        lines.push(`    -> ${m.name}  (${m.reason})`);
      });
    }

    if (rest.length > 0) {
      lines.push('');
      lines.push('  OPTIONAL SKILLS:');
      rest.forEach(m => {
        lines.push(`    -> ${m.name}  (${m.reason})`);
      });
    }

    lines.push('');
    lines.push('  ACTION: Read .claude/skills/<name>/SKILL.md before responding');
    lines.push('--------------------------------------------');
    lines.push('');

    // Write to stdout - Claude Code captures this as hook output
    process.stdout.write(lines.join('\n'));

  } catch (e) {
    // Silent failure - hooks must never break the workflow
    process.exit(0);
  }
});
