/**
 * Tests for textUtils.js
 */

import { describe, it, expect } from 'vitest';
import { extractTextFromHtml } from '../../../utils/textUtils';

describe('extractTextFromHtml', () => {
  describe('null/undefined handling', () => {
    it('returns empty string for null', () => {
      expect(extractTextFromHtml(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(extractTextFromHtml(undefined)).toBe('');
    });

    it('returns empty string for non-string input', () => {
      expect(extractTextFromHtml(123)).toBe('');
      expect(extractTextFromHtml({})).toBe('');
      expect(extractTextFromHtml([])).toBe('');
    });
  });

  describe('HTML tag removal', () => {
    it('removes simple HTML tags', () => {
      expect(extractTextFromHtml('<p>Hello World</p>')).toBe('Hello World');
    });

    it('removes nested tags', () => {
      expect(extractTextFromHtml('<div><span>Nested</span></div>')).toBe('Nested');
    });

    it('handles self-closing tags', () => {
      expect(extractTextFromHtml('Hello<br/>World')).toContain('Hello');
      expect(extractTextFromHtml('Hello<br/>World')).toContain('World');
    });
  });

  describe('HTML entity decoding', () => {
    it('decodes &lt; and &gt;', () => {
      const input = '&lt;script&gt;alert("xss")&lt;/script&gt;';
      const result = extractTextFromHtml(input);
      expect(result).not.toContain('&lt;');
      expect(result).not.toContain('&gt;');
    });

    it('decodes &amp;', () => {
      expect(extractTextFromHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
    });

    it('decodes &quot;', () => {
      expect(extractTextFromHtml('Say &quot;Hello&quot;')).toBe('Say "Hello"');
    });

    it('decodes &#39; (apostrophe)', () => {
      expect(extractTextFromHtml('It&#39;s working')).toBe("It's working");
    });

    it('replaces &nbsp; with spaces', () => {
      expect(extractTextFromHtml('Hello&nbsp;World')).toBe('Hello World');
    });
  });

  describe('paragraph structure preservation', () => {
    it('converts <br> to newlines', () => {
      const result = extractTextFromHtml('Line 1<br>Line 2');
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
    });

    it('converts </p> to double newlines', () => {
      const result = extractTextFromHtml('<p>Para 1</p><p>Para 2</p>');
      expect(result).toContain('Para 1');
      expect(result).toContain('Para 2');
    });

    it('converts </div> to newlines', () => {
      const result = extractTextFromHtml('<div>Block 1</div><div>Block 2</div>');
      expect(result).toContain('Block 1');
      expect(result).toContain('Block 2');
    });

    it('converts </li> to newlines', () => {
      const result = extractTextFromHtml('<ul><li>Item 1</li><li>Item 2</li></ul>');
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
    });
  });

  describe('whitespace normalization', () => {
    it('collapses multiple spaces', () => {
      expect(extractTextFromHtml('Hello    World')).toBe('Hello World');
    });

    it('limits consecutive newlines to 2', () => {
      const result = extractTextFromHtml('<p>A</p><p></p><p></p><p>B</p>');
      const newlineCount = (result.match(/\n/g) || []).length;
      expect(newlineCount).toBeLessThanOrEqual(2);
    });

    it('trims leading and trailing whitespace', () => {
      expect(extractTextFromHtml('  <p>Hello</p>  ')).toBe('Hello');
    });
  });

  describe('double-encoded content', () => {
    it('handles double-encoded HTML entities', () => {
      // Content that was encoded twice: < becomes &lt; becomes &amp;lt;
      const doubleEncoded = '&amp;lt;p&amp;gt;Text&amp;lt;/p&amp;gt;';
      const result = extractTextFromHtml(doubleEncoded);
      // Should recursively decode
      expect(result).toContain('Text');
    });
  });

  describe('real-world Microsoft Graph API content', () => {
    it('handles typical Outlook email body', () => {
      const outlookBody = `
        <html>
          <body>
            <div>Hi Team,</div>
            <div>&nbsp;</div>
            <div>Please join the meeting at 3pm.</div>
            <div>&nbsp;</div>
            <div>Thanks,<br>John</div>
          </body>
        </html>
      `;
      const result = extractTextFromHtml(outlookBody);
      expect(result).toContain('Hi Team');
      expect(result).toContain('Please join the meeting at 3pm');
      expect(result).toContain('Thanks');
      expect(result).toContain('John');
    });

    it('handles plain text input (no HTML)', () => {
      const plainText = 'This is just plain text without any HTML.';
      expect(extractTextFromHtml(plainText)).toBe(plainText);
    });
  });
});
