import { describe, it, expect } from 'vitest';
import { deriveTranscript } from './transcript.js';

describe('deriveTranscript', () => {
  it('returns an empty array for no messages', () => {
    expect(deriveTranscript(undefined)).toEqual([]);
    expect(deriveTranscript([])).toEqual([]);
  });

  it('skips the very first user message (the raw brief dump)', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Here is the brief. Location: Mission...' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Quick question before I compose.' }] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([{ kind: 'agent', text: 'Quick question before I compose.' }]);
  });

  it('renders working tool calls as tool turns, but not request_user_input/compose_walk/web_search', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'geocode_location', input: { query: 'Mission' } },
        { type: 'tool_use', id: 'tu2', name: 'request_user_input', input: { question: 'Denser or quieter?' } },
      ] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([
      { kind: 'tool', tool: 'geocode_location', input: { query: 'Mission' }, doneAt: 1, error: null },
    ]);
  });

  it('renders a request_user_input reply as a user turn, distinguished by tool_use_id — not by content shape', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'request_user_input', input: { question: 'Denser or quieter?' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'Denser, lean into the Mission.' },
      ] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([{ kind: 'user', text: 'Denser, lean into the Mission.' }]);
  });

  it('does not render a normal tool result as a chat turn, even one shaped like a plain string', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'geocode_location', input: { query: 'x' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: '{"lat":37.7,"lng":-122.4}' },
      ] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([
      { kind: 'tool', tool: 'geocode_location', input: { query: 'x' }, doneAt: 1, error: null },
    ]);
  });

  it('renders a refinement note (plain user text after the first message) as a user turn', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Composed.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Make it shorter.' }] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([
      { kind: 'agent', text: 'Composed.' },
      { kind: 'user', text: 'Make it shorter.' },
    ]);
  });

  it('reconstructs a full mixed conversation in order', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'hist', name: 'get_user_history', input: {} },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'hist', content: '{"walks":[]}' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'A couple of quick calibrations.' },
        { type: 'tool_use', id: 'q1', name: 'request_user_input', input: { question: 'Street or architecture?' } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Street.' }] },
    ];
    const turns = deriveTranscript(messages);
    expect(turns).toEqual([
      { kind: 'tool', tool: 'get_user_history', input: {}, doneAt: 1, error: null },
      { kind: 'agent', text: 'A couple of quick calibrations.' },
      { kind: 'user', text: 'Street.' },
    ]);
  });
});
