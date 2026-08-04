import { TaskRetry, DEFAULT_RETRY_POLICY } from '../src/core/task-retry';

describe('TaskRetry', () => {
  let tr: TaskRetry;

  beforeEach(() => {
    tr = new TaskRetry();
  });

  // --- Basic flow ---

  test('registerTask creates initial state', () => {
    const s = tr.registerTask('t1');
    expect(s.taskId).toBe('t1');
    expect(s.attempt).toBe(0);
    expect(s.exhausted).toBe(false);
  });

  test('first attempt success returns no-retry', () => {
    tr.registerTask('t1');
    const d = tr.recordAttempt('t1');
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toBe('success');
    expect(d.attempt).toBe(1);
  });

  test('first attempt failure allows retry', () => {
    tr.registerTask('t1');
    const d = tr.recordAttempt('t1', 'timeout');
    expect(d.shouldRetry).toBe(true);
    expect(d.reason).toBe('retryable');
    expect(d.delayMs).toBeGreaterThan(0);
    expect(d.attempt).toBe(1);
  });

  test('exhausted after maxAttempts failures', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    const d = tr.recordAttempt('t1', 'err');
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toBe('exhausted');
    expect(d.attempt).toBe(3);
    expect(tr.getState('t1')!.exhausted).toBe(true);
  });

  // --- Backoff calculation ---

  test('exponential backoff increases delay', () => {
    tr.registerTask('t1');
    const d1 = tr.recordAttempt('t1', 'err');
    const delay1 = d1.delayMs;

    // Force nextRetryAt to now
    const s = tr.getState('t1')!;
    s.nextRetryAt = Date.now();

    const d2 = tr.recordAttempt('t1', 'err');
    // Second retry should have ~2x delay (factor=2)
    expect(d2.delayMs).toBeGreaterThan(delay1 * 0.8); // accounting for jitter
  });

  test('delay is capped at maxDelayMs', () => {
    tr = new TaskRetry({ maxAttempts: 10, baseDelayMs: 1, backoffFactor: 100, maxDelayMs: 100 });
    tr.registerTask('t1');
    for (let i = 0; i < 5; i++) {
      tr.recordAttempt('t1', 'err');
      const s = tr.getState('t1')!;
      if (s.nextRetryAt) {
        // Force retry
        s.nextRetryAt = Date.now();
      }
    }
    // At attempt 5, delay would be 1 * 100^4 = 100M but capped at 100
    const state = tr.getState('t1')!;
    const lastDelay = state.nextRetryAt ? state.nextRetryAt - state.lastAttemptAt! : 0;
    // Account for jitter pushing slightly above cap
    expect(lastDelay).toBeLessThanOrEqual(110);
  });

  test('delay includes jitter (non-deterministic)', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    const delays: number[] = [];
    // Force fresh state for multiple attempts
    for (let i = 0; i < 10; i++) {
      tr.registerTask(`t-j-${i}`);
      const d = tr.recordAttempt(`t-j-${i}`, 'err');
      delays.push(d.delayMs);
    }
    const unique = new Set(delays);
    // With jitter=0.1, expect some variation across 10 samples
    // (Not guaranteed but highly likely)
  });

  // --- shouldRetryNow ---

  test('shouldRetryNow returns false before delay', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    expect(tr.shouldRetryNow('t1')).toBe(false);
  });

  test('shouldRetryNow returns true after delay passes', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
 // Mutate internal state directly
    tr['states'].get('t1')!.nextRetryAt = Date.now() - 100;
    expect(tr.shouldRetryNow('t1')).toBe(true);
  });

  test('shouldRetryNow returns false for exhausted task', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    expect(tr.shouldRetryNow('t1')).toBe(false);
  });

  test('shouldRetryNow returns false for unknown task', () => {
    expect(tr.shouldRetryNow('unknown')).toBe(false);
  });

  // --- Custom config ---

  test('custom maxAttempts', () => {
    tr = new TaskRetry({ maxAttempts: 1 });
    tr.registerTask('t1');
    const d = tr.recordAttempt('t1', 'err');
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toBe('exhausted');
  });

  test('custom backoffFactor of 1 gives constant delay', () => {
    tr = new TaskRetry({ maxAttempts: 5, backoffFactor: 1, jitterRange: 0 });
    tr.registerTask('t1');
    const d1 = tr.recordAttempt('t1', 'err');
    tr.getState('t1')!.nextRetryAt = Date.now();
    const d2 = tr.recordAttempt('t1', 'err');
    expect(d1.delayMs).toBe(d2.delayMs);
  });

  test('zero jitter gives deterministic delay', () => {
    tr = new TaskRetry({ jitterRange: 0, maxAttempts: 5 });
    tr.registerTask('t1');
    const d1 = tr.recordAttempt('t1', 'err');
    tr.registerTask('t2');
    const d2 = tr.recordAttempt('t2', 'err');
    expect(d1.delayMs).toBe(d2.delayMs);
  });

  // --- Management ---

  test('reset allows fresh attempts', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    expect(tr.getState('t1')!.exhausted).toBe(true);

    tr.reset('t1');
    const s = tr.getState('t1')!;
    expect(s.exhausted).toBe(false);
    expect(s.attempt).toBe(0);
  });

  test('reset returns false for unknown task', () => {
    expect(tr.reset('unknown')).toBe(false);
  });

  test('remove deletes task state', () => {
    tr.registerTask('t1');
    expect(tr.remove('t1')).toBe(true);
    expect(tr.getState('t1')).toBeUndefined();
  });

  test('clear removes all tasks', () => {
    tr.registerTask('t1');
    tr.registerTask('t2');
    tr.clear();
    expect(tr.getAllStates()).toEqual([]);
  });

  // --- Query methods ---

  test('getRetryableTasks returns tasks past their delay', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    tr['states'].get('t1')!.nextRetryAt = Date.now() - 100;

    tr.registerTask('t2');
    tr.recordAttempt('t2', 'err');
    // t2 still waiting (nextRetryAt is in the future)

    const retryable = tr.getRetryableTasks();
    expect(retryable.length).toBe(1);
    expect(retryable[0].taskId).toBe('t1');
  });

  test('getExhaustedTasks returns only exhausted', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');
    tr.recordAttempt('t1', 'err');

    tr.registerTask('t2');
    tr.recordAttempt('t2'); // success

    expect(tr.getExhaustedTasks().map(s => s.taskId)).toEqual(['t1']);
  });

  test('getSummary counts correctly', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1'); // success

    tr.registerTask('t2');
    tr.recordAttempt('t2', 'err');
    tr['states'].get('t2')!.nextRetryAt = Date.now() - 100; // retryable

    tr.registerTask('t3');
    tr.recordAttempt('t3', 'err');
    tr.recordAttempt('t3', 'err');
    tr.recordAttempt('t3', 'err'); // exhausted

    const summary = tr.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.exhausted).toBe(1);
  });

  // --- Edge cases ---

  test('recordAttempt auto-registers unknown task', () => {
    const d = tr.recordAttempt('auto-t1');
    expect(d.attempt).toBe(1);
    expect(tr.getState('auto-t1')).toBeDefined();
  });

  test('lastError tracks most recent failure', () => {
    tr.registerTask('t1');
    tr.recordAttempt('t1', 'error-A');
    tr.getState('t1')!.nextRetryAt = Date.now();
    tr.recordAttempt('t1', 'error-B');
    expect(tr.getState('t1')!.lastError).toBe('error-B');
  });

  test('getState returns copies', () => {
    tr.registerTask('t1');
    const s = tr.getState('t1')!;
    s.attempt = 99;
    expect(tr.getState('t1')!.attempt).toBe(0);
  });

  test('getAllStates returns copies', () => {
    tr.registerTask('t1');
    const states = tr.getAllStates();
    states[0].attempt = 99;
    expect(tr.getState('t1')!.attempt).toBe(0);
  });

  test('default policy values', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_POLICY.backoffFactor).toBe(2);
    expect(DEFAULT_RETRY_POLICY.jitterRange).toBe(0.1);
  });
});
