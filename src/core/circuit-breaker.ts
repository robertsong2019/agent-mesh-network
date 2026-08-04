/**
 * CircuitBreaker — Per-peer failure tracking with open/half-open/closed states.
 * 
 * Prevents routing tasks to consistently failing peers.
 * Pure logic, no networking dependencies.
 */

export interface CircuitState {
  peerId: string;
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  openedAt: number | null;       // timestamp when circuit opened
  lastFailureAt: number | null;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;        // failures before opening (default: 3)
  resetTimeoutMs: number;         // ms before half-open transition (default: 30000)
  halfOpenMaxAttempts: number;    // probes in half-open before reopening (default: 1)
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 1
};

export class CircuitBreaker {
  private circuits: Map<string, CircuitState> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  /**
   * Record a success for a peer
   */
  recordSuccess(peerId: string): CircuitState {
    const c = this.getOrCreate(peerId);
    c.totalSuccesses++;
    c.consecutiveFailures = 0;

    if (c.state === 'half-open') {
      c.state = 'closed';
      c.openedAt = null;
    }

    return { ...c };
  }

  /**
   * Record a failure for a peer
   */
  recordFailure(peerId: string): CircuitState {
    const c = this.getOrCreate(peerId);
    c.totalFailures++;
    c.consecutiveFailures++;
    c.lastFailureAt = Date.now();

    if (c.state === 'half-open') {
      // Probe failed — reopen
      c.state = 'open';
      c.openedAt = Date.now();
      c.consecutiveFailures = this.config.failureThreshold;
    } else if (c.state === 'closed' && c.consecutiveFailures >= this.config.failureThreshold) {
      c.state = 'open';
      c.openedAt = Date.now();
    }

    return { ...c };
  }

  /**
   * Check if a peer's circuit allows requests
   */
  canAttempt(peerId: string): boolean {
    const c = this.circuits.get(peerId);
    if (!c) return true;  // no circuit = always allowed

    if (c.state === 'closed') return true;
    if (c.state === 'open') {
      // Check if enough time has passed for half-open transition
      if (c.openedAt && Date.now() - c.openedAt >= this.config.resetTimeoutMs) {
        c.state = 'half-open';
        c.consecutiveFailures = 0;
        return true;
      }
      return false;
    }
    // half-open: allow limited probes
    return true;
  }

  /**
   * Get circuit state for a peer
   */
  getState(peerId: string): CircuitState | undefined {
    const c = this.circuits.get(peerId);
    return c ? { ...c } : undefined;
  }

  /**
   * Get all circuits
   */
  getAllCircuits(): CircuitState[] {
    return Array.from(this.circuits.values()).map(c => ({ ...c }));
  }

  /**
   * Get circuits by state
   */
  getCircuitsByState(state: CircuitState['state']): CircuitState[] {
    return this.getAllCircuits().filter(c => c.state === state);
  }

  /**
   * Get count of peers in each state
   */
  getSummary(): { closed: number; open: number; halfOpen: number; total: number } {
    let closed = 0, open = 0, halfOpen = 0;
    for (const c of this.circuits.values()) {
      if (c.state === 'closed') closed++;
      else if (c.state === 'open') open++;
      else halfOpen++;
    }
    return { closed, open, halfOpen, total: this.circuits.size };
  }

  /**
   * Manually reset a peer's circuit to closed
   */
  reset(peerId: string): boolean {
    const c = this.circuits.get(peerId);
    if (!c) return false;
    c.state = 'closed';
    c.consecutiveFailures = 0;
    c.openedAt = null;
    return true;
  }

  /**
   * Remove a peer's circuit entirely
   */
  remove(peerId: string): boolean {
    return this.circuits.delete(peerId);
  }

  /**
   * Clear all circuits
   */
  clear(): void {
    this.circuits.clear();
  }

  private getOrCreate(peerId: string): CircuitState {
    let c = this.circuits.get(peerId);
    if (!c) {
      c = {
        peerId,
        state: 'closed',
        consecutiveFailures: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        openedAt: null,
        lastFailureAt: null
      };
      this.circuits.set(peerId, c);
    }
    return c;
  }
}

export default CircuitBreaker;
