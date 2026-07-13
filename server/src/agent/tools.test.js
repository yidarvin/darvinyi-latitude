import { describe, it, expect, vi, beforeEach } from 'vitest';
import polyline from '@mapbox/polyline';

const { mockPrisma, mockWalkingDirections } = vi.hoisted(() => ({
  mockPrisma: {
    walk: { create: vi.fn(), update: vi.fn() },
    stop: { deleteMany: vi.fn() },
    agentRun: { update: vi.fn() },
    $transaction: vi.fn(async (ops) => Promise.all(ops)),
  },
  mockWalkingDirections: vi.fn(),
}));

vi.mock('../db.js', () => ({ prisma: mockPrisma }));
vi.mock('../lib/mapbox.js', () => ({
  geocode: vi.fn(),
  walkingDirections: mockWalkingDirections,
}));
vi.mock('../lib/openmeteo.js', () => ({ getWeather: vi.fn() }));

const {
  resolveWalkingRoute,
  createWalkFromCompose,
  updateWalkFromCompose,
  executeTool,
} = await import('./tools.js');

const STOP_A = { ordinal: 1, lat: 37.76, lng: -122.43, name: 'A', arrival_time: '10:00', duration_minutes: 20, brief: 'Shoot the light on the wall.' };
const STOP_B = { ordinal: 2, lat: 37.77, lng: -122.42, name: 'B', arrival_time: '10:30', duration_minutes: 20, brief: 'Frame the alley.' };
const STOP_C = { ordinal: 3, lat: 37.78, lng: -122.41, name: 'C', arrival_time: '11:00', duration_minutes: 20, brief: 'Wide shot of the mural.' };

function composedInput(stops, extra = {}) {
  return {
    title: 'Edge Conditions',
    subtitle: 'A study of seams',
    brief: 'A short walk through the seams of the neighborhood, worth the detour.',
    centerLat: 37.77,
    centerLng: -122.42,
    timeOfDay: 'golden',
    durationMin: 60,
    distanceM: 1200,
    stops,
    conditions: { light: 'Warm.', weather: 'Clear.', camera_notes: 'Bring a fast lens.', afterward: 'Grab coffee.' },
    ...extra,
  };
}

describe('resolveWalkingRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not append the origin for a one-way walk', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'abc', distance_m: 500 });
    const composed = composedInput([STOP_A, STOP_B]);

    await resolveWalkingRoute(composed, { roundTrip: false });

    expect(mockWalkingDirections).toHaveBeenCalledWith([
      { lat: STOP_A.lat, lng: STOP_A.lng },
      { lat: STOP_B.lat, lng: STOP_B.lng },
    ]);
  });

  it('closes the loop by appending the first stop when the agent left first != last on a round trip', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'abc', distance_m: 900 });
    const composed = composedInput([STOP_A, STOP_B, STOP_C]);

    await resolveWalkingRoute(composed, { roundTrip: true });

    const calledWith = mockWalkingDirections.mock.calls[0][0];
    expect(calledWith).toHaveLength(4);
    expect(calledWith[3]).toEqual({ lat: STOP_A.lat, lng: STOP_A.lng });
  });

  it('does not duplicate the origin on a round trip when the agent already closed the loop', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'abc', distance_m: 900 });
    const closingStop = { ...STOP_A, ordinal: 3 };
    const composed = composedInput([STOP_A, STOP_B, closingStop]);

    await resolveWalkingRoute(composed, { roundTrip: true });

    const calledWith = mockWalkingDirections.mock.calls[0][0];
    expect(calledWith).toHaveLength(3);
  });

  it('falls back to the agent-supplied polyline only when it decodes cleanly', async () => {
    mockWalkingDirections.mockRejectedValue(new Error('Mapbox directions failed: 500'));
    const validEncoded = polyline.encode([[37.76, -122.43], [37.77, -122.42]]);
    const composed = composedInput([STOP_A, STOP_B], { walkingPolyline: validEncoded, distanceM: 750 });

    const result = await resolveWalkingRoute(composed, { roundTrip: false });

    expect(result.polyline).toBe(validEncoded);
    expect(result.distanceM).toBe(750);
  });

  it('throws when Mapbox fails and there is no fallback polyline', async () => {
    mockWalkingDirections.mockRejectedValue(new Error('Mapbox directions failed: 500'));
    const composed = composedInput([STOP_A, STOP_B]);

    await expect(resolveWalkingRoute(composed, { roundTrip: false })).rejects.toThrow();
  });

  it('throws when Mapbox fails and the fallback polyline does not decode', async () => {
    mockWalkingDirections.mockRejectedValue(new Error('Mapbox directions failed: 500'));
    const composed = composedInput([STOP_A, STOP_B], { walkingPolyline: 'not-a-valid-polyline!!' });

    await expect(resolveWalkingRoute(composed, { roundTrip: false })).rejects.toThrow();
  });
});

describe('createWalkFromCompose', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the walk, leaving the AgentRun row to its caller (the loop)', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'xyz', distance_m: 1000 });
    mockPrisma.walk.create.mockResolvedValue({ id: 'walk-1' });

    const composed = composedInput([STOP_A, STOP_B]);
    const briefSnapshot = { locationName: 'Mission, SF', cameraLabel: 'X100VI', lensSpec: '', mobility: ['foot'], styles: ['street'], roundTrip: false };

    const walkId = await createWalkFromCompose('user-1', briefSnapshot, composed);

    expect(walkId).toBe('walk-1');
    expect(mockPrisma.walk.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.walk.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-1');
    expect(createArgs.data.stops.create).toHaveLength(2);
    expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
  });
});

describe('compute_route tool input validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-numeric or out-of-range coordinate instead of forwarding it to Mapbox', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'xyz', distance_m: 500 });
    await expect(
      executeTool('compute_route', { stops: [{ lat: 37.76, lng: -122.43 }, { lat: 999, lng: -122.42 }] }, {})
    ).rejects.toThrow(/compute_route input invalid/);
    expect(mockWalkingDirections).not.toHaveBeenCalled();
  });

  it('rejects a coordinate carrying a string (e.g. an injection attempt) instead of a number', async () => {
    await expect(
      executeTool('compute_route', { stops: [{ lat: 37.76, lng: -122.43 }, { lat: '0,0?access_token=x#', lng: -122.42 }] }, {})
    ).rejects.toThrow(/compute_route input invalid/);
    expect(mockWalkingDirections).not.toHaveBeenCalled();
  });

  it('accepts a well-formed stop list and forwards it to Mapbox', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'xyz', distance_m: 500 });
    const result = await executeTool('compute_route', { stops: [{ lat: 37.76, lng: -122.43 }, { lat: 37.77, lng: -122.42 }] }, {});
    expect(mockWalkingDirections).toHaveBeenCalledWith([{ lat: 37.76, lng: -122.43 }, { lat: 37.77, lng: -122.42 }]);
    expect(result.polyline).toBe('xyz');
  });
});

describe('updateWalkFromCompose', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces stops and updates the walk in a single transaction', async () => {
    mockWalkingDirections.mockResolvedValue({ polyline: 'xyz', distance_m: 800 });
    mockPrisma.walk.update.mockResolvedValue({});

    const composed = composedInput([STOP_A, STOP_B]);
    const walkId = await updateWalkFromCompose('walk-1', { roundTrip: false }, composed);

    expect(walkId).toBe('walk-1');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.stop.deleteMany).toHaveBeenCalledWith({ where: { walkId: 'walk-1' } });
  });
});
