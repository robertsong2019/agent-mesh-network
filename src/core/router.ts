/**
 * TaskRouter — Intelligent task routing for agent mesh networks.
 * 
 * Evaluates incoming bids, selects best executor, and tracks task lifecycle.
 * Pure logic, no networking dependencies.
 */

import { MeshRegistry, PeerEntry, CapabilityScore } from './registry';

export interface Bid {
  taskId: string;
  nodeId: string;
  estimatedTime: number;  // ms
  confidence: number;     // 0..1
  load: number;           // 0..1
  timestamp: number;
}

export interface RoutingDecision {
  taskId: string;
  winner: string | null;  // nodeId
  score: number;
  bidsEvaluated: number;
  reason: string;
}

export interface TaskLifecycle {
  id: string;
  type: string;
  requiredCapabilities: string[];
  status: 'pending' | 'bidding' | 'assigned' | 'completed' | 'failed' | 'timeout';
  createdAt: number;
  assignedTo: string | null;
  result: any | null;
  error: string | null;
  bids: Bid[];
}

export class TaskRouter {
  private registry: MeshRegistry;
  private tasks: Map<string, TaskLifecycle> = new Map();
  private taskTimeoutMs: number;
  private maxBids: number;

  constructor(registry: MeshRegistry, options?: { taskTimeoutMs?: number; maxBids?: number }) {
    this.registry = registry;
    this.taskTimeoutMs = options?.taskTimeoutMs ?? 60000;
    this.maxBids = options?.maxBids ?? 10;
  }

  /**
   * Create a new task
   */
  createTask(id: string, type: string, requiredCapabilities: string[]): TaskLifecycle {
    const task: TaskLifecycle = {
      id, type, requiredCapabilities,
      status: 'pending',
      createdAt: Date.now(),
      assignedTo: null, result: null, error: null,
      bids: []
    };
    this.tasks.set(id, task);
    return task;
  }

  /**
   * Submit a bid for a task
   */
  submitBid(bid: Bid): boolean {
    const task = this.tasks.get(bid.taskId);
    if (!task) return false;
    if (task.status !== 'pending' && task.status !== 'bidding') return false;
    if (task.bids.length >= this.maxBids) return false;

    // Don't allow self-bidding duplicate
    if (task.bids.some(b => b.nodeId === bid.nodeId)) return false;

    task.bids.push(bid);
    task.status = 'bidding';
    return true;
  }

  /**
   * Evaluate all bids and select winner
   */
  evaluateBids(taskId: string): RoutingDecision {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { taskId, winner: null, score: 0, bidsEvaluated: 0, reason: 'task-not-found' };
    }

    if (task.bids.length === 0) {
      return { taskId, winner: null, score: 0, bidsEvaluated: 0, reason: 'no-bids' };
    }

    // Score each bid
    const scored = task.bids.map(bid => {
      const peer = this.registry.getPeer(bid.nodeId);
      
      // Base score: confidence * (1 - load)
      let score = bid.confidence * (1 - bid.load);

      // Time factor: prefer shorter estimates (normalize to 0-30s range)
      const timeNorm = Math.min(bid.estimatedTime / 30000, 1);
      score *= (1 - 0.2 * timeNorm);

      // Peer reputation boost
      if (peer) {
        score *= (0.5 + 0.5 * peer.successRate);
        // Peer with matching capability gets bonus
        const hasRequired = task.requiredCapabilities.some(c => peer.capabilities.includes(c));
        if (hasRequired) score *= 1.2;
      }

      return { nodeId: bid.nodeId, score, bid };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];

    return {
      taskId,
      winner: winner.nodeId,
      score: winner.score,
      bidsEvaluated: task.bids.length,
      reason: winner.score > 0.5 ? 'strong-match' : 'best-available'
    };
  }

  /**
   * Assign task to winner (updates task status + registry)
   */
  assignTask(taskId: string): RoutingDecision {
    const decision = this.evaluateBids(taskId);
    if (!decision.winner) return decision;

    const task = this.tasks.get(taskId)!;
    task.status = 'assigned';
    task.assignedTo = decision.winner;
    this.registry.setPeerStatus(decision.winner, 'busy');
    return decision;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, result: any, latencyMs: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'assigned') return false;

    task.status = 'completed';
    task.result = result;
    if (task.assignedTo) {
      this.registry.recordResult(task.assignedTo, true, latencyMs);
      this.registry.setPeerStatus(task.assignedTo, 'online');
    }
    return true;
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string, latencyMs: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'assigned') return false;

    task.status = 'failed';
    task.error = error;
    if (task.assignedTo) {
      this.registry.recordResult(task.assignedTo, false, latencyMs);
      this.registry.setPeerStatus(task.assignedTo, 'online');
    }
    return true;
  }

  /**
   * Get expired tasks (past timeout)
   */
  getExpiredTasks(): TaskLifecycle[] {
    const now = Date.now();
    return this.getAllTasks().filter(t =>
      (t.status === 'pending' || t.status === 'bidding' || t.status === 'assigned') &&
      now - t.createdAt > this.taskTimeoutMs
    );
  }

  /**
   * Auto-assign tasks that have enough bids
   */
  autoAssign(minBids?: number): RoutingDecision[] {
    const threshold = minBids ?? 1;
    return this.getAllTasks()
      .filter(t => (t.status === 'pending' || t.status === 'bidding') && t.bids.length >= threshold)
      .map(t => this.assignTask(t.id));
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): TaskLifecycle | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TaskLifecycle[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get task count
   */
  get taskCount(): number {
    return this.tasks.size;
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskLifecycle['status']): TaskLifecycle[] {
    return this.getAllTasks().filter(t => t.status === status);
  }

  /**
   * Clear all tasks
   */
  clearTasks(): void {
    this.tasks.clear();
  }
}

export default TaskRouter;
