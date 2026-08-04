/**
 * TaskRetry — Retry policy manager for failed tasks.
 * 
 * Supports exponential backoff with jitter, max attempts, and per-task tracking.
 * Pure logic, no networking dependencies.
 */

export interface RetryPolicy {
  maxAttempts: number;          // total attempts including first (default: 3)
  baseDelayMs: number;          // base delay before first retry (default: 1000)
  maxDelayMs: number;           // cap on backoff delay (default: 30000)
  backoffFactor: number;        // multiplier per retry (default: 2)
  jitterRange: number;          // 0..1, fraction of delay for random jitter (default: 0.1)
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitterRange: 0.1
};

export interface RetryState {
  taskId: string;
  attempt: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  exhausted: boolean;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  attempt: number;
  reason: string;
}

export class TaskRetry {
  private states: Map<string, RetryState> = new Map();
  private policy: RetryPolicy;

  constructor(policy?: Partial<RetryPolicy>) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy };
  }

  /**
   * Register a new task for retry tracking
   */
  registerTask(taskId: string): RetryState {
    const state: RetryState = {
      taskId,
      attempt: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      lastError: null,
      exhausted: false
    };
    this.states.set(taskId, state);
    return { ...state };
  }

  /**
   * Record an attempt (success or failure)
   */
  recordAttempt(taskId: string, error?: string): RetryDecision {
    let state = this.states.get(taskId);
    if (!state) {
      state = this.registerTask(taskId);
    }

    state.attempt++;
    state.lastAttemptAt = Date.now();
    state.lastError = error ?? null;

    if (!error) {
      // Success — clear retry state
      state.exhausted = false;
      state.nextRetryAt = null;
      return { shouldRetry: false, delayMs: 0, attempt: state.attempt, reason: 'success' };
    }

    // Failure — check if retries remain
    if (state.attempt >= this.policy.maxAttempts) {
      state.exhausted = true;
      state.nextRetryAt = null;
      return { shouldRetry: false, delayMs: 0, attempt: state.attempt, reason: 'exhausted' };
    }

    const delay = this.calculateDelay(state.attempt);
    state.nextRetryAt = Date.now() + delay;

    return { shouldRetry: true, delayMs: delay, attempt: state.attempt, reason: 'retryable' };
  }

  /**
   * Check if a task should be retried now
   */
  shouldRetryNow(taskId: string): boolean {
    const state = this.states.get(taskId);
    if (!state || state.exhausted || !state.nextRetryAt) return false;
    return Date.now() >= state.nextRetryAt;
  }

  /**
   * Get retry state for a task
   */
  getState(taskId: string): RetryState | undefined {
    const s = this.states.get(taskId);
    return s ? { ...s } : undefined;
  }

  /**
   * Get all tracked tasks
   */
  getAllStates(): RetryState[] {
    return Array.from(this.states.values()).map(s => ({ ...s }));
  }

  /**
   * Get tasks eligible for immediate retry
   */
  getRetryableTasks(): RetryState[] {
    return this.getAllStates().filter(s => this.shouldRetryNow(s.taskId));
  }

  /**
   * Get exhausted (permanently failed) tasks
   */
  getExhaustedTasks(): RetryState[] {
    return this.getAllStates().filter(s => s.exhausted);
  }

  /**
   * Remove a task from tracking
   */
  remove(taskId: string): boolean {
    return this.states.delete(taskId);
  }

  /**
   * Reset a task's retry state (allow fresh attempts)
   */
  reset(taskId: string): boolean {
    const state = this.states.get(taskId);
    if (!state) return false;
    state.attempt = 0;
    state.lastAttemptAt = null;
    state.nextRetryAt = null;
    state.lastError = null;
    state.exhausted = false;
    return true;
  }

  /**
   * Clear all tracked tasks
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Summary stats
   */
  getSummary(): {
    total: number;
    exhausted: number;
    retryable: number;
    success: number;
  } {
    let exhausted = 0, retryable = 0, success = 0;
    for (const s of this.states.values()) {
      if (s.exhausted) exhausted++;
      else if (this.shouldRetryNow(s.taskId)) retryable++;
      else if (!s.nextRetryAt && s.attempt > 0) success++;
    }
    return { total: this.states.size, exhausted, retryable, success };
  }

  private calculateDelay(attempt: number): number {
    // Exponential: base * factor^(attempt-1)
    const exponential = this.policy.baseDelayMs * Math.pow(this.policy.backoffFactor, attempt - 1);
    const capped = Math.min(exponential, this.policy.maxDelayMs);

    // Add jitter: random offset in [-jitterRange/2, jitterRange/2] * delay
    const jitter = (Math.random() - 0.5) * this.policy.jitterRange * capped;
    return Math.max(0, Math.round(capped + jitter));
  }
}

export default TaskRetry;
