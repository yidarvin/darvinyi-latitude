import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────
const { mockPrisma, mockStreamFactory, mockMessagesCreate, mockDecryptApiKey, mockExecuteTool, mockCreateWalk, mockUpdateWalk, mockValidateCompose, MockAPIUserAbortError } = vi.hoisted(() => {
  class MockAPIUserAbortError extends Error {}
  return {
    mockPrisma: {
      agentRun: {
        findUnique: vi.fn(),
        update:     vi.fn(),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      // Used only by generateFolioInsight (fire-and-forget after a
      // successful compose) — findMany defaults to no history so that
      // tests not concerned with it return early without a mocked
      // messages.create response.
      walk: {
        findMany: vi.fn(async () => []),
      },
      user: {
        update: vi.fn(),
      },
    },
    mockStreamFactory: vi.fn(),
    // Separate from mockStreamFactory — generateFolioInsight uses the
    // non-streaming client.messages.create(), not client.messages.stream().
    mockMessagesCreate: vi.fn(async () => ({ content: [{ type: 'text', text: 'A generated insight.' }] })),
    mockDecryptApiKey: vi.fn(() => 'sk-ant-fake-decrypted-key'),
    mockExecuteTool: vi.fn(async () => ({ ok: true })),
    mockCreateWalk: vi.fn(async () => 'walk-created-1'),
    mockUpdateWalk: vi.fn(async () => 'walk-updated-1'),
    // Loop-level tests exercise the state machine, not validation itself
    // (that's compose-validation.test.js) — pass input through unchanged
    // by default; individual tests can override to simulate a rejection.
    mockValidateCompose: vi.fn((input) => input),
    MockAPIUserAbortError,
  };
});

vi.mock('../db.js', () => ({ prisma: mockPrisma }));
vi.mock('../lib/crypto.js', () => ({ decryptApiKey: mockDecryptApiKey }));
vi.mock('./tools.js', () => ({
  TOOL_DEFS: [],
  executeTool: mockExecuteTool,
  createWalkFromCompose: mockCreateWalk,
  updateWalkFromCompose: mockUpdateWalk,
  validateComposeInput: mockValidateCompose,
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {}
    messages = {
      stream: (...args) => mockStreamFactory(...args),
      create: (...args) => mockMessagesCreate(...args),
    };
  },
  APIUserAbortError: MockAPIUserAbortError,
}));

const { runAgentLoop, abortActiveRun, closeAllActiveRuns, reapIfStale } = await import('./loop.js');

// ── Test helpers ────────────────────────────────────────────────

/** A stream whose finalMessage() resolves/rejects immediately. */
function fakeStream(finalMessageOrError) {
  return {
    on: vi.fn(),
    abort: vi.fn(),
    finalMessage: vi.fn(async () => {
      if (finalMessageOrError instanceof Error) throw finalMessageOrError;
      return finalMessageOrError;
    }),
  };
}

/** A stream whose finalMessage() stays pending until resolve/reject is called
 *  — lets a test interleave a disconnect or a second loop mid-generation.
 *  abort() rejects with APIUserAbortError, matching the real SDK. */
function controllableStream() {
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  return {
    on: vi.fn(),
    finalMessage: vi.fn(() => promise),
    abort: vi.fn(() => settle.reject(new MockAPIUserAbortError('aborted'))),
    resolve: (msg) => settle.resolve(msg),
    reject: (err) => settle.reject(err),
  };
}

function fakeSSE() {
  const events = [];
  let closed = false;
  const closeListeners = [];
  return {
    events,
    send: vi.fn((event, data) => events.push({ event, data })),
    heartbeat: vi.fn(),
    close: vi.fn(() => {
      if (closed) return;
      closed = true;
      closeListeners.splice(0).forEach((cb) => cb());
    }),
    isClosed: vi.fn(() => closed),
    onClose: vi.fn((cb) => { if (closed) cb(); else closeListeners.push(cb); }),
    _simulateDisconnect() {
      if (closed) return;
      closed = true;
      closeListeners.splice(0).forEach((cb) => cb());
    },
  };
}

function baseRun(overrides = {}) {
  return {
    id: 'run-1',
    status: 'active',
    walkId: null,
    messages: [],
    updatedAt: new Date(), // fresh — reapIfStale should never trigger on these fixtures
    briefSnapshot: {
      locationName: 'Mission, SF', durationMin: 60, timeOfDay: 'golden',
      cameraLabel: 'X100VI', lensSpec: '35mm', mobility: ['foot'], styles: ['street'],
      roundTrip: false, intent: null,
    },
    user: { id: 'user-1', apiKeyCipher: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't' },
    ...overrides,
  };
}

function erroredUpdateCalls() {
  return mockPrisma.agentRun.update.mock.calls.filter(([args]) => args.data.status === 'error');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptApiKey.mockReturnValue('sk-ant-fake-decrypted-key');
  mockPrisma.agentRun.updateMany.mockResolvedValue({ count: 1 });
});

describe('runAgentLoop — state machine', () => {
  it('fails the run when the agent ends the turn without ever composing a walk', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory.mockReturnValueOnce(
      fakeStream({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nothing to add' }] })
    );

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Agent ended without composing a walk.' });
    expect(sse.close).toHaveBeenCalled();
    expect(erroredUpdateCalls()).toHaveLength(1);
  });

  it('ends a refinement turn as a plain reply (turn_end) when the agent already has a walk and answers conversationally', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun({ walkId: 'walk-1' }));
    mockStreamFactory.mockReturnValueOnce(
      fakeStream({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure — the alley is safe after dusk.' }] })
    );

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('turn_end', {});
    expect(sse.close).toHaveBeenCalled();
    const composedUpdate = mockPrisma.agentRun.updateMany.mock.calls.find(([args]) => args.data.status === 'composed');
    expect(composedUpdate).toBeTruthy();
  });

  it('executes a normal tool call and reports tool_start/tool_done', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockExecuteTool.mockResolvedValueOnce({ lat: 37.77, lng: -122.42 });
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'geocode_location', input: { query: 'Union Square' } }],
      }))
      .mockReturnValueOnce(fakeStream({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockExecuteTool).toHaveBeenCalledWith('geocode_location', { query: 'Union Square' }, { userId: 'user-1', runId: 'run-1' });
    expect(sse.send).toHaveBeenCalledWith('tool_start', { tool: 'geocode_location', input: { query: 'Union Square' } });
    expect(sse.send).toHaveBeenCalledWith('tool_done', { tool: 'geocode_location' });
  });

  it('pauses for request_user_input and sends the question', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu2', name: 'request_user_input', input: { question: 'Denser or quieter?' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('awaiting_user', { question: 'Denser or quieter?', toolUseId: 'tu2' });
    expect(mockExecuteTool).not.toHaveBeenCalled();
    const awaitingUpdate = mockPrisma.agentRun.updateMany.mock.calls.find(([args]) => args.data.status === 'awaiting_user');
    expect(awaitingUpdate).toBeTruthy();
  });

  it('recovers instead of failing when request_user_input is combined with other tool calls', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu-mix-1', name: 'geocode_location', input: { query: 'x' } },
          { type: 'tool_use', id: 'tu-mix-2', name: 'request_user_input', input: { question: 'q?' } },
        ],
      }))
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-solo', name: 'request_user_input', input: { question: 'q2?' } }],
      }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(erroredUpdateCalls()).toHaveLength(0);
    expect(sse.send).toHaveBeenCalledWith('awaiting_user', { question: 'q2?', toolUseId: 'tu-solo' });
  });

  it('creates a new walk on first-pass compose_walk', async () => {
    const composeInput = { title: 'Edge Conditions', stops: [] };
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu3', name: 'compose_walk', input: composeInput }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockCreateWalk).toHaveBeenCalledWith('user-1', expect.any(Object), composeInput);
    expect(mockUpdateWalk).not.toHaveBeenCalled();
    expect(sse.send).toHaveBeenCalledWith('composed', { walkId: 'walk-created-1' });
  });

  it('updates the existing walk in place when refining (run already has a walkId)', async () => {
    const composeInput = { title: 'Edge Conditions (revised)', stops: [] };
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun({ walkId: 'walk-1' }));
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu4', name: 'compose_walk', input: composeInput }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockUpdateWalk).toHaveBeenCalledWith('walk-1', expect.any(Object), composeInput);
    expect(mockCreateWalk).not.toHaveBeenCalled();
  });

  it('self-corrects on a compose_walk failure instead of failing the whole run', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockCreateWalk.mockRejectedValueOnce(new Error('lat out of range'));
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-bad-compose', name: 'compose_walk', input: { title: 'x' } }],
      }))
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-fixed-compose', name: 'compose_walk', input: { title: 'x fixed' } }],
      }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(erroredUpdateCalls()).toHaveLength(0);
    expect(mockCreateWalk).toHaveBeenCalledTimes(2);
    expect(sse.send).toHaveBeenCalledWith('composed', { walkId: 'walk-created-1' });
  });

  it('self-corrects when compose_walk input fails validation, without ever reaching Prisma', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockValidateCompose.mockImplementationOnce(() => {
      throw new Error('compose_walk input invalid — stops.1: 2481.3km from the walk center');
    });
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-bad-input', name: 'compose_walk', input: { title: 'x' } }],
      }))
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-good-input', name: 'compose_walk', input: { title: 'x fixed' } }],
      }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockCreateWalk).not.toHaveBeenCalledWith('user-1', expect.any(Object), { title: 'x' });
    expect(erroredUpdateCalls()).toHaveLength(0);
    expect(sse.send).toHaveBeenCalledWith('composed', { walkId: 'walk-created-1' });
  });

  it('fails safely on a genuinely unexpected stop_reason', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory.mockReturnValueOnce(fakeStream({ stop_reason: 'stop_sequence', content: [] }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Unexpected stop_reason: stop_sequence' });
  });

  it('fails the run once MAX_LOOP_ITERATIONS is genuinely exhausted', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockExecuteTool.mockResolvedValue({ ok: true });
    mockStreamFactory.mockReturnValue(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-loop', name: 'geocode_location', input: { query: 'x' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Agent run exceeded maximum iterations' });
  }, 10000);

  it('refuses to resume an abandoned run', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun({ status: 'abandoned' }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockStreamFactory).not.toHaveBeenCalled();
    expect(sse.send).toHaveBeenCalledWith('error', { message: 'This walk was stopped.' });
  });
});

describe('runAgentLoop — folio insight regeneration', () => {
  // generateFolioInsight is fire-and-forget (called after the SSE is
  // already closed, not awaited by runAgentLoop) — so these tests await
  // runAgentLoop first, then vi.waitFor the side effect it triggers, rather
  // than asserting immediately.

  it('regenerates the folio insight from recent walk history after a successful compose', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockPrisma.walk.findMany.mockResolvedValueOnce([
      { title: 'Marine Pause', locationName: 'Outer Sunset, San Francisco', timeOfDay: 'golden', styles: ['landscape'], date: new Date('2026-06-01') },
    ]);
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-insight', name: 'compose_walk', input: { title: 'Edge Conditions' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');
    expect(sse.send).toHaveBeenCalledWith('composed', { walkId: 'walk-created-1' });

    await vi.waitFor(() => expect(mockPrisma.user.update).toHaveBeenCalled());
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { insightText: 'A generated insight.', insightGeneratedAt: expect.any(Date) },
    });
  });

  it('skips insight generation entirely when the user has no walk history yet', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockPrisma.walk.findMany.mockResolvedValueOnce([]);
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-insight-empty', name: 'compose_walk', input: { title: 'First Walk' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');
    await vi.waitFor(() => expect(mockPrisma.walk.findMany).toHaveBeenCalled());

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('a failure generating the folio insight does not affect the run\'s own success', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockPrisma.walk.findMany.mockResolvedValueOnce([
      { title: 'Rivets and Rain', locationName: 'Dogpatch, San Francisco', timeOfDay: 'morning', styles: ['documentary'], date: new Date('2026-06-02') },
    ]);
    mockMessagesCreate.mockRejectedValueOnce(new Error('Anthropic overloaded'));
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-insight-fail', name: 'compose_walk', input: { title: 'Edge Conditions' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('composed', { walkId: 'walk-created-1' });
    expect(erroredUpdateCalls()).toHaveLength(0);

    await vi.waitFor(() => expect(mockMessagesCreate).toHaveBeenCalledTimes(1));
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('runAgentLoop — prompt caching', () => {
  it('marks a cache breakpoint on the request without persisting cache_control into stored messages', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-cache', name: 'request_user_input', input: { question: 'q?' } }],
    }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    // The outgoing request carries a cache breakpoint on the last content block.
    const requestArgs = mockStreamFactory.mock.calls[0][0];
    expect(requestArgs.system[0].cache_control).toEqual({ type: 'ephemeral' });
    const lastMsg = requestArgs.messages[requestArgs.messages.length - 1];
    const lastBlock = lastMsg.content[lastMsg.content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });

    // Nothing persisted to the DB carries a cache_control marker — it's a
    // per-request hint, not conversation content.
    const persistedCalls = [...mockPrisma.agentRun.update.mock.calls, ...mockPrisma.agentRun.updateMany.mock.calls];
    for (const [args] of persistedCalls) {
      if (!args.data.messages) continue;
      expect(JSON.stringify(args.data.messages)).not.toContain('cache_control');
    }
  });
});

describe('runAgentLoop — pause_turn and max_tokens', () => {
  it('resumes automatically on pause_turn without appending an extra user message', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'still searching…' }] }))
      .mockReturnValueOnce(fakeStream({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'found it' }], }));
    // walkId set so end_turn resolves as a clean refinement reply, not a failure
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun({ walkId: 'walk-1' }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockStreamFactory).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockStreamFactory.mock.calls[1][0].messages;
    // No synthetic user message was inserted between the paused turn and the resume.
    expect(secondCallMessages[secondCallMessages.length - 1].role).toBe('assistant');
    expect(erroredUpdateCalls()).toHaveLength(0);
  });

  it('retries once with a larger budget on max_tokens, and succeeds if the retry fits', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'truncat' }] }))
      .mockReturnValueOnce(fakeStream({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-retry-ok', name: 'request_user_input', input: { question: 'q?' } }],
      }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockStreamFactory).toHaveBeenCalledTimes(2);
    expect(sse.send).toHaveBeenCalledWith('awaiting_user', { question: 'q?', toolUseId: 'tu-retry-ok' });
    expect(erroredUpdateCalls()).toHaveLength(0);
  });

  it('fails cleanly with an honest message when max_tokens recurs on the retry', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockStreamFactory
      .mockReturnValueOnce(fakeStream({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'a' }] }))
      .mockReturnValueOnce(fakeStream({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'b' }] }));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('error', {
      message: "The agent's response was too long, even after retrying with more room. Try a shorter brief or fewer stops.",
    });
    expect(erroredUpdateCalls()).toHaveLength(1);
  });
});

describe('runAgentLoop — Anthropic API error handling', () => {
  it('leaves the run resumable (not errored) on a retryable Anthropic failure', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const rateLimited = Object.assign(new Error('rate limited'), { status: 429 });
    mockStreamFactory.mockReturnValueOnce(fakeStream(rateLimited));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(erroredUpdateCalls()).toHaveLength(0);
    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Anthropic rate limit hit — try again in a moment.', retryable: true });
    const resumableUpdate = mockPrisma.agentRun.updateMany.mock.calls.find(([args]) => args.data.status === 'active');
    expect(resumableUpdate).toBeTruthy();
  });

  it('leaves the run resumable on a 529 overloaded error', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const overloaded = Object.assign(new Error('overloaded'), { status: 529 });
    mockStreamFactory.mockReturnValueOnce(fakeStream(overloaded));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(erroredUpdateCalls()).toHaveLength(0);
    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Anthropic is briefly overloaded. Try again in a minute.', retryable: true });
  });

  it('terminally fails the run on a non-retryable Anthropic error (invalid key)', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const unauthorized = Object.assign(new Error('bad key'), { status: 401 });
    mockStreamFactory.mockReturnValueOnce(fakeStream(unauthorized));

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(sse.send).toHaveBeenCalledWith('error', { message: 'Your Anthropic API key is invalid. Rotate it in Account.' });
    expect(erroredUpdateCalls()).toHaveLength(1);
  });
});

describe('runAgentLoop — disconnect handling', () => {
  it('does not brick the run when the client disconnects before the next iteration starts', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    mockExecuteTool.mockResolvedValue({ ok: true });
    // Only ever provide ONE stream — if the loop incorrectly starts a second
    // iteration after the disconnect, mockStreamFactory would be called
    // again with nothing queued and throw, failing the test loudly.
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-a', name: 'geocode_location', input: { query: 'x' } }],
    }));

    const sse = fakeSSE();
    // Simulate the browser vanishing right after the first tool call resolves
    // by closing the sse from inside the tool call itself.
    mockExecuteTool.mockImplementationOnce(async () => {
      sse._simulateDisconnect();
      return { ok: true };
    });

    await runAgentLoop(sse, 'run-1');

    expect(mockStreamFactory).toHaveBeenCalledTimes(1);
    expect(erroredUpdateCalls()).toHaveLength(0);
  });

  it('aborts the in-flight Anthropic call the instant the client disconnects mid-generation', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const controllable = controllableStream();
    mockStreamFactory.mockReturnValueOnce(controllable);

    const sse = fakeSSE();
    const runPromise = runAgentLoop(sse, 'run-1');

    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(1));
    sse._simulateDisconnect();
    await runPromise;

    expect(controllable.abort).toHaveBeenCalled();
    expect(erroredUpdateCalls()).toHaveLength(0);
  });

  it('finishes executing already-started tool calls even after the client disconnects mid-list', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const sse = fakeSSE();
    let secondToolCalled = false;
    mockExecuteTool
      .mockImplementationOnce(async () => { sse._simulateDisconnect(); return { ok: true }; })
      .mockImplementationOnce(async () => { secondToolCalled = true; return { ok: true }; });
    mockStreamFactory.mockReturnValueOnce(fakeStream({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu-first', name: 'geocode_location', input: { query: 'a' } },
        { type: 'tool_use', id: 'tu-second', name: 'geocode_location', input: { query: 'b' } },
      ],
    }));

    await runAgentLoop(sse, 'run-1');

    expect(secondToolCalled).toBe(true);
  });
});

describe('abortActiveRun / concurrency guard', () => {
  it('preempts an already-running loop for the same run when a new connection starts', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const firstStream = controllableStream();
    const secondStream = controllableStream();
    mockStreamFactory
      .mockReturnValueOnce(firstStream)
      .mockReturnValueOnce(secondStream);

    const sse1 = fakeSSE();
    const run1Promise = runAgentLoop(sse1, 'run-1');
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(1));

    const sse2 = fakeSSE();
    const run2Promise = runAgentLoop(sse2, 'run-1');

    await vi.waitFor(() => expect(firstStream.abort).toHaveBeenCalled());
    expect(sse1.close).toHaveBeenCalled();
    await run1Promise;
    expect(erroredUpdateCalls()).toHaveLength(0);

    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(2));
    secondStream.resolve({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-second-loop', name: 'request_user_input', input: { question: 'q?' } }],
    });
    await run2Promise;

    expect(sse2.send).toHaveBeenCalledWith('awaiting_user', { question: 'q?', toolUseId: 'tu-second-loop' });
  });

  it('a preempted loop does not persist compose_walk once a newer connection has taken over the run', async () => {
    // Regression test: abortActiveRun's stream.abort() only cancels an
    // in-flight Anthropic call. If the old loop's model call has already
    // resolved with a compose_walk tool_use by the time a second connection
    // takes over, the old loop must not go on to create/update a Walk —
    // otherwise a reconnect racing a slow compose_walk produces a duplicate.
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const firstStream = controllableStream();
    const secondStream = controllableStream();
    mockStreamFactory
      .mockReturnValueOnce(firstStream)
      .mockReturnValueOnce(secondStream);

    const sse1 = fakeSSE();
    const run1Promise = runAgentLoop(sse1, 'run-1');
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(1));

    // Resolve loop A's model call with a compose_walk tool_use, then — in
    // the same synchronous tick, before loop A's continuation gets to run —
    // start a second connection for the same run. runAgentLoop's preemption
    // bookkeeping (abortActiveRun + activeRuns.set) runs synchronously up to
    // its first await, so this reliably lands before loop A resumes.
    firstStream.resolve({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-compose', name: 'compose_walk', input: { title: 'Race' } }],
    });
    const sse2 = fakeSSE();
    const run2Promise = runAgentLoop(sse2, 'run-1');

    await run1Promise;
    expect(mockCreateWalk).not.toHaveBeenCalled();
    expect(mockUpdateWalk).not.toHaveBeenCalled();
    expect(erroredUpdateCalls()).toHaveLength(0);

    // The newer loop is unaffected and proceeds normally.
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(2));
    secondStream.resolve({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu-second', name: 'request_user_input', input: { question: 'q?' } }],
    });
    await run2Promise;
    expect(sse2.send).toHaveBeenCalledWith('awaiting_user', { question: 'q?', toolUseId: 'tu-second' });
  });

  it('abortActiveRun stops a live loop even while its SSE connection is still open', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const controllable = controllableStream();
    mockStreamFactory.mockReturnValueOnce(controllable);

    const sse = fakeSSE();
    const runPromise = runAgentLoop(sse, 'run-1');
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(1));

    const stopped = abortActiveRun('run-1');
    expect(stopped).toBe(true);
    expect(controllable.abort).toHaveBeenCalled();
    expect(sse.close).toHaveBeenCalled();

    await runPromise;
    expect(erroredUpdateCalls()).toHaveLength(0);
  });

  it('abortActiveRun is a safe no-op when nothing is running for that id', () => {
    expect(abortActiveRun('no-such-run')).toBe(false);
  });

  it('closeAllActiveRuns stops every live loop for a clean, resumable shutdown', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(baseRun());
    const streamA = controllableStream();
    const streamB = controllableStream();
    mockStreamFactory
      .mockReturnValueOnce(streamA)
      .mockReturnValueOnce(streamB);

    const sseA = fakeSSE();
    const sseB = fakeSSE();
    const runA = runAgentLoop(sseA, 'run-a');
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(1));
    const runB = runAgentLoop(sseB, 'run-b');
    await vi.waitFor(() => expect(mockStreamFactory).toHaveBeenCalledTimes(2));

    closeAllActiveRuns();

    expect(sseA.close).toHaveBeenCalled();
    expect(sseB.close).toHaveBeenCalled();
    expect(streamA.abort).toHaveBeenCalled();
    expect(streamB.abort).toHaveBeenCalled();

    await Promise.all([runA, runB]);
    expect(erroredUpdateCalls()).toHaveLength(0);
  });
});

describe('reapIfStale', () => {
  beforeEach(() => {
    mockPrisma.agentRun.update.mockResolvedValue({});
  });

  it('flips a run stuck active/awaiting_user for >24h to abandoned', async () => {
    const staleRun = baseRun({ status: 'active', updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    mockPrisma.agentRun.update.mockResolvedValue({ ...staleRun, status: 'abandoned' });

    const result = await reapIfStale(staleRun);

    expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: staleRun.id },
      data: { status: 'abandoned' },
    });
    expect(result.status).toBe('abandoned');
  });

  it('leaves a recently-active run untouched', async () => {
    const freshRun = baseRun({ status: 'active', updatedAt: new Date() });
    const result = await reapIfStale(freshRun);
    expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
    expect(result).toBe(freshRun);
  });

  it('never reaps a composed or already-terminal run, regardless of age', async () => {
    const oldComposed = baseRun({ status: 'composed', updatedAt: new Date(Date.now() - 999 * 60 * 60 * 1000) });
    const result = await reapIfStale(oldComposed);
    expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
    expect(result).toBe(oldComposed);
  });

  it('a stream connection to a genuinely stale run gets an abandoned response, not a resurrection', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue(
      baseRun({ status: 'awaiting_user', updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
    );
    mockPrisma.agentRun.update.mockResolvedValue({ status: 'abandoned' });

    const sse = fakeSSE();
    await runAgentLoop(sse, 'run-1');

    expect(mockStreamFactory).not.toHaveBeenCalled();
    expect(sse.send).toHaveBeenCalledWith('error', { message: 'This walk was stopped.' });
  });
});
