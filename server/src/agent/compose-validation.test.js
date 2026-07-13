import { describe, it, expect } from 'vitest';
import { validateComposeInput } from './tools.js';

function validStop(overrides = {}) {
  return {
    ordinal: 1,
    name: 'Balmy Alley',
    lat: 37.7503,
    lng: -122.4133,
    arrival_time: '10:00',
    duration_minutes: 20,
    brief: 'Shoot the murals along the alley wall.',
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    title: 'Edge Conditions',
    subtitle: 'A study of seams · 4 frames',
    brief: 'A short walk through the seams of the Mission, worth the detour on a quiet morning.',
    centerLat: 37.7509,
    centerLng: -122.4148,
    timeOfDay: 'golden',
    durationMin: 60,
    distanceM: 1200,
    stops: [
      validStop({ ordinal: 1, name: 'Balmy Alley' }),
      validStop({ ordinal: 2, name: 'Clarion Alley', lat: 37.7519, lng: -122.4213 }),
      validStop({ ordinal: 3, name: '24th Street', lat: 37.7524, lng: -122.4184 }),
    ],
    conditions: {
      light: 'Warm afternoon light on the west-facing walls.',
      weather: 'Clear, upper 60s.',
      camera_notes: 'A fast prime is plenty here.',
      afterward: 'Save the walk, then rest your feet at a taqueria.',
    },
    ...overrides,
  };
}

describe('validateComposeInput', () => {
  it('accepts a well-formed compose_walk input and returns the parsed data', () => {
    const result = validateComposeInput(validInput());
    expect(result.title).toBe('Edge Conditions');
    expect(result.stops).toHaveLength(3);
  });

  it('rejects a stop count below the 1-hour minimum (3 stops)', () => {
    const input = validInput({ stops: [validStop({ ordinal: 1 }), validStop({ ordinal: 2, name: 'B' })] });
    expect(() => validateComposeInput(input)).toThrow(/compose_walk input invalid/);
  });

  it('rejects more than 12 stops', () => {
    const stops = Array.from({ length: 13 }, (_, i) => validStop({ ordinal: i + 1, name: `Stop ${i + 1}` }));
    expect(() => validateComposeInput(validInput({ stops }))).toThrow();
  });

  it('rejects a swapped lat/lng (out of range latitude)', () => {
    const input = validInput({
      stops: [
        validStop({ ordinal: 1 }),
        validStop({ ordinal: 2, name: 'Swapped', lat: -122.4213, lng: 37.7519 }), // lat/lng swapped
        validStop({ ordinal: 3 }),
      ],
    });
    expect(() => validateComposeInput(input)).toThrow(/lat/);
  });

  it('rejects duplicate or non-sequential stop ordinals', () => {
    const input = validInput({
      stops: [
        validStop({ ordinal: 1 }),
        validStop({ ordinal: 1, name: 'Duplicate ordinal' }),
        validStop({ ordinal: 3 }),
      ],
    });
    expect(() => validateComposeInput(input)).toThrow(/ordinal/i);
  });

  it('rejects a stop implausibly far from the walk center (bad geocode)', () => {
    const input = validInput({
      stops: [
        validStop({ ordinal: 1 }),
        validStop({ ordinal: 2, name: 'Wrong city', lat: 34.0522, lng: -118.2437 }), // Los Angeles
        validStop({ ordinal: 3 }),
      ],
    });
    expect(() => validateComposeInput(input)).toThrow(/km from the walk center/);
  });

  it('rejects an invalid timeOfDay enum value', () => {
    expect(() => validateComposeInput(validInput({ timeOfDay: 'afternoon' }))).toThrow();
  });

  it('rejects a brief that is too short', () => {
    expect(() => validateComposeInput(validInput({ brief: 'Too short.' }))).toThrow();
  });

  it('rejects a stop brief that is too short', () => {
    const input = validInput({
      stops: [validStop({ ordinal: 1, brief: 'short' }), validStop({ ordinal: 2 }), validStop({ ordinal: 3 })],
    });
    expect(() => validateComposeInput(input)).toThrow();
  });

  it('reports every violation in one error, not just the first', () => {
    const input = validInput({ timeOfDay: 'nope', title: '' });
    try {
      validateComposeInput(input);
      throw new Error('expected validateComposeInput to throw');
    } catch (err) {
      expect(err.message).toMatch(/timeOfDay/);
      expect(err.message).toMatch(/title/);
    }
  });

  it('accepts a walk sized at the 1-hour minimum of 3 stops', () => {
    const input = validInput({
      durationMin: 60,
      stops: [validStop({ ordinal: 1 }), validStop({ ordinal: 2 }), validStop({ ordinal: 3 })],
    });
    expect(() => validateComposeInput(input)).not.toThrow();
  });
});
