import { CircuitBreaker, DEFAULT_CIRCUIT_CONFIG } from '../src/core/circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  // --- Basic state transitions ---

  test('starts in closed state for new peer', () => {
    expect(cb.canAttempt('peer-a')).toBe(true);
    expect(cb.getState('peer-a')).toBeUndefined();
  });

  test('success keeps circuit closed', () => {
    const s = cb.recordSuccess('p1');
    expect(s.state).toBe('closed');
    expect(s.totalSuccesses).toBe(1);
    expect(s.consecutiveFailures).toBe(0);
  });

  test('single failure does not open circuit', () => {
    const s = cb.recordFailure('p1');
    expect(s.state).toBe('closed');
    expect(s.consecutiveFailures).toBe(1);
  });

  test('opens circuit after threshold failures', () => {
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    const s = cb.recordFailure('p1');
    expect(s.state).toBe('open');
    expect(s.consecutiveFailures).toBe(3);
    expect(s.openedAt).not.toBeNull();
  });

  test('open circuit blocks attempts', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    expect(cb.canAttempt('p1')).toBe(false);
  });

  test('success resets consecutive failures in closed state', () => {
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    cb.recordSuccess('p1');
    const s = cb.getState('p1')!;
    expect(s.consecutiveFailures).toBe(0);
    expect(s.state).toBe('closed');
  });

  // --- Half-open transition ---

  test('transitions to half-open after reset timeout', () => {
    cb = new CircuitBreaker({ resetTimeoutMs: 100 });
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    expect(cb.canAttempt('p1')).toBe(false);

    // Wait for reset timeout
    jest.advanceTimersByTime(150);
    // Manually advance Date.now() by mocking
    const state = cb.getState('p1')!;
    state.openedAt = Date.now() - 150; // force timeout
    // Re-check with updated openedAt
    cb['circuits'].set('p1', state);

    expect(cb.canAttempt('p1')).toBe(true);
    expect(cb.getState('p1')!.state).toBe('half-open');
  });

  test('success in half-open closes circuit', () => {
    // Force half-open
    cb['circuits'].set('p1', {
      peerId: 'p1', state: 'half-open', consecutiveFailures: 0,
      totalFailures: 3, totalSuccesses: 0, openedAt: null, lastFailureAt: null
    });
    const s = cb.recordSuccess('p1');
    expect(s.state).toBe('closed');
  });

  test('failure in half-open reopens circuit', () => {
    cb['circuits'].set('p1', {
      peerId: 'p1', state: 'half-open', consecutiveFailures: 0,
      totalFailures: 3, totalSuccesses: 0, openedAt: null, lastFailureAt: null
    });
    const s = cb.recordFailure('p1');
    expect(s.state).toBe('open');
    expect(s.openedAt).not.toBeNull();
  });

  // --- Multiple peers ---

  test('tracks circuits independently per peer', () => {
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    expect(cb.getState('p1')!.consecutiveFailures).toBe(2);
    expect(cb.getState('p2')).toBeUndefined();
  });

  test('getSummary counts states correctly', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p-open');
    cb.recordSuccess('p-closed');
    cb['circuits'].set('p-half', {
      peerId: 'p-half', state: 'half-open', consecutiveFailures: 0,
      totalFailures: 1, totalSuccesses: 0, openedAt: null, lastFailureAt: null
    });

    const summary = cb.getSummary();
    expect(summary.closed).toBe(1);
    expect(summary.open).toBe(1);
    expect(summary.halfOpen).toBe(1);
    expect(summary.total).toBe(3);
  });

  test('getCircuitsByState filters correctly', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    cb.recordSuccess('p2');
    expect(cb.getCircuitsByState('open').map(c => c.peerId)).toEqual(['p1']);
    expect(cb.getCircuitsByState('closed').map(c => c.peerId)).toEqual(['p2']);
    expect(cb.getCircuitsByState('half-open')).toEqual([]);
  });

  // --- Custom config ---

  test('respects custom failureThreshold', () => {
    cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure('p1');
    expect(cb.getState('p1')!.state).toBe('closed');
    cb.recordFailure('p1');
    expect(cb.getState('p1')!.state).toBe('open');
  });

  test('respects custom resetTimeoutMs', () => {
    cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    cb.recordFailure('p1');
    expect(cb.canAttempt('p1')).toBe(false);

    // Force timeout expired
    const s = cb.getState('p1')!;
    s.openedAt = Date.now() - 6000;
    cb['circuits'].set('p1', s);
    expect(cb.canAttempt('p1')).toBe(true);
  });

  // --- Management ---

  test('reset manually closes a circuit', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    expect(cb.getState('p1')!.state).toBe('open');
    expect(cb.reset('p1')).toBe(true);
    expect(cb.getState('p1')!.state).toBe('closed');
    expect(cb.getState('p1')!.consecutiveFailures).toBe(0);
  });

  test('reset returns false for non-existent peer', () => {
    expect(cb.reset('nonexistent')).toBe(false);
  });

  test('remove deletes a circuit', () => {
    cb.recordFailure('p1');
    expect(cb.remove('p1')).toBe(true);
    expect(cb.getState('p1')).toBeUndefined();
  });

  test('remove returns false for non-existent peer', () => {
    expect(cb.remove('nonexistent')).toBe(false);
  });

  test('clear removes all circuits', () => {
    cb.recordFailure('p1');
    cb.recordSuccess('p2');
    cb.clear();
    expect(cb.getAllCircuits()).toEqual([]);
    expect(cb.getSummary().total).toBe(0);
  });

  // --- Edge cases ---

  test('handles rapid success/failure interleaving', () => {
    cb.recordFailure('p1');
    cb.recordSuccess('p1');
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    expect(cb.getState('p1')!.state).toBe('closed'); // only 2 consecutive
    expect(cb.getState('p1')!.totalFailures).toBe(3);
    expect(cb.getState('p1')!.totalSuccesses).toBe(1);
  });

  test('lastFailureAt is set on failure', () => {
    const before = Date.now();
    cb.recordFailure('p1');
    const s = cb.getState('p1')!;
    expect(s.lastFailureAt).not.toBeNull();
    expect(s.lastFailureAt! >= before).toBe(true);
  });

  test('getAllCircuits returns copies', () => {
    cb.recordFailure('p1');
    const circuits = cb.getAllCircuits();
    circuits[0].consecutiveFailures = 99;
    expect(cb.getState('p1')!.consecutiveFailures).toBe(1);
  });

  test('canAttempt returns true for unknown peer', () => {
    expect(cb.canAttempt('never-seen')).toBe(true);
  });

  // --- Integration with default config ---

  test('default config has expected values', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(3);
    expect(DEFAULT_CIRCUIT_CONFIG.resetTimeoutMs).toBe(30000);
    expect(DEFAULT_CIRCUIT_CONFIG.halfOpenMaxAttempts).toBe(1);
  });
});
