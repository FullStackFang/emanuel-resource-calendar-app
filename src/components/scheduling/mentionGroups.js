import { parseTimeToken } from './sheetEventUtils';
import { locationSegment, personSegment, textSegment, splitMentionTokens } from './useMentionPicker';

export function addToGroup(segments, openIndex, segment) {
  if (segment.type === 'person') return { segments: [...segments, segment], openIndex: segments.length };
  if (openIndex != null && segment.type !== 'textTopLevel') {
    return { segments: segments.map((current, index) => index === openIndex
      ? { ...current, details: [...(current.details || []), segment] }
      : current), openIndex };
  }
  return { segments: [...segments, segment], openIndex };
}

export function removeLastGroupPart(segments, openIndex) {
  if (openIndex != null && segments[openIndex]?.details?.length) {
    return { segments: segments.map((segment, index) => index === openIndex
      ? { ...segment, details: segment.details.slice(0, -1) }
      : segment), openIndex };
  }
  if (openIndex != null) return { segments: segments.filter((_, index) => index !== openIndex), openIndex: null };
  return { segments: segments.slice(0, -1), openIndex: null };
}

export function defaultMentionSegment(token, openIndex, people, locations) {
  const term = token.startsWith('@') ? token.slice(1).trim() : token.trim();
  if (!term) return null;
  const time = parseTimeToken(term);
  if (openIndex != null) return textSegment(time?.display || term);
  if (time) return textSegment(time.display);
  const q = term.toLowerCase();
  const person = (people || []).find((p) => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q));
  if (person) return personSegment(person);
  const location = (locations || []).find((l) => l.displayName?.toLowerCase().includes(q));
  if (location) return locationSegment(location);
  return textSegment(token.trim());
}

export function consumeMentionTokens(value, segments, openIndex, people, locations) {
  const tokens = splitMentionTokens(value);
  if (tokens.length === 1) return { segments, openIndex, input: value };
  if (openIndex == null && tokens.every((token) => defaultMentionSegment(token, null, people, locations)?.type === 'text')) {
    return { segments, openIndex, input: value };
  }
  let state = { segments, openIndex };
  for (const token of tokens.slice(0, -1)) {
    const segment = defaultMentionSegment(token, state.openIndex, people, locations);
    if (segment) state = addToGroup(state.segments, state.openIndex, segment);
  }
  return { ...state, input: tokens.at(-1) };
}

export function pendingGroupedInput(input, segments, openIndex, people, locations, plainSegment) {
  if (!input.trim()) return segments;
  if (!input.startsWith('@')) return [...segments, plainSegment];
  const segment = defaultMentionSegment(input, openIndex, people, locations);
  return segment ? addToGroup(segments, openIndex, segment).segments : segments;
}
