/**
 * Tests for TaskRouter — intelligent task routing
 */

import { MeshRegistry, PeerEntry } from '../src/core/registry';
import { TaskRouter, Bid, RoutingDecision } from '../src/core/router';

const makePeer = (overrides: Partial<PeerEntry> & { id: string }): PeerEntry => ({
  capabilities: [],
  status: 'online',
  lastSeen: Date.now(),
  load: 0,
  successRate: 1,
  avgLatency: 0,
  ...overrides,
});

const makeBid = (overrides: Partial<Bid> & { taskId: string; nodeId: string }): Bid => ({
  estimatedTime: 1000,
  confidence: 0.9,
  load: 0.1,
  timestamp: Date.now(),
  ...overrides,
});

describe('TaskRouter', () => {
  let reg: MeshRegistry;
  let router: TaskRouter;

  beforeEach(() => {
    reg = new MeshRegistry();
    router = new TaskRouter(reg);
  });

  describe('createTask', () => {
    test('creates a pending task', () => {
      const task = router.createTask('t1', 'translation', ['translate']);
      expect(task.id).toBe('t1');
      expect(task.type).toBe('translation');
      expect(task.status).toBe('pending');
      expect(task.bids).toEqual([]);
      expect(router.taskCount).toBe(1);
    });

    test('allows creating tasks with empty capabilities', () => {
      const task = router.createTask('t2', 'ping', []);
      expect(task.requiredCapabilities).toEqual([]);
    });
  });

  describe('submitBid', () => {
    test('accepts valid bid for pending task', () => {
      router.createTask('t1', 'x', ['a']);
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }))).toBe(true);
      const task = router.getTask('t1')!;
      expect(task.bids).toHaveLength(1);
      expect(task.status).toBe('bidding');
    });

    test('rejects bid for non-existent task', () => {
      expect(router.submitBid(makeBid({ taskId: 'nope', nodeId: 'p1' }))).toBe(false);
    });

    test('rejects bid for completed task', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      router.assignTask('t1');
      router.completeTask('t1', 'ok', 100);
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2' }))).toBe(false);
    });

    test('rejects duplicate bids from same node', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }))).toBe(false);
    });

    test('rejects bids beyond maxBids', () => {
      router = new TaskRouter(reg, { maxBids: 2 });
      router.createTask('t1', 'x', ['a']);
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }))).toBe(true);
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2' }))).toBe(true);
      expect(router.submitBid(makeBid({ taskId: 't1', nodeId: 'p3' }))).toBe(false);
    });
  });

  describe('evaluateBids', () => {
    test('returns no-bids for empty task', () => {
      router.createTask('t1', 'x', ['a']);
      const d = router.evaluateBids('t1');
      expect(d.winner).toBeNull();
      expect(d.reason).toBe('no-bids');
    });

    test('returns task-not-found for missing task', () => {
      const d = router.evaluateBids('nope');
      expect(d.reason).toBe('task-not-found');
    });

    test('selects higher confidence bid', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.5 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2', confidence: 0.9 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p2');
      expect(d.bidsEvaluated).toBe(2);
    });

    test('selects lower load bid when confidence equal', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.8, load: 0.8 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2', confidence: 0.8, load: 0.1 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p2');
    });

    test('selects faster estimate when other factors equal', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.8, load: 0.3, estimatedTime: 20000 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2', confidence: 0.8, load: 0.3, estimatedTime: 1000 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p2');
    });

    test('boosts score for peer with matching capability', () => {
      router.createTask('t1', 'x', ['translate']);
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['translate'], successRate: 1 }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['cook'], successRate: 1 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.7 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2', confidence: 0.7 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p1');
    });

    test('factors in peer success rate', () => {
      router.createTask('t1', 'x', ['a']);
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.3 }));
      reg.upsertPeer(makePeer({ id: 'p2', successRate: 0.95 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.8, load: 0.1 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p2', confidence: 0.8, load: 0.1 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p2');
    });

    test('returns best-available for low-scoring winner', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.1, load: 0.9 }));
      const d = router.evaluateBids('t1');
      expect(d.reason).toBe('best-available');
    });
  });

  describe('assignTask', () => {
    test('assigns winner and updates status', () => {
      router.createTask('t1', 'x', ['a']);
      reg.upsertPeer(makePeer({ id: 'p1' }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      const d = router.assignTask('t1');
      expect(d.winner).toBe('p1');
      expect(router.getTask('t1')!.status).toBe('assigned');
      expect(router.getTask('t1')!.assignedTo).toBe('p1');
      expect(reg.getPeer('p1')!.status).toBe('busy');
    });

    test('returns decision without winner when no bids', () => {
      router.createTask('t1', 'x', ['a']);
      const d = router.assignTask('t1');
      expect(d.winner).toBeNull();
    });
  });

  describe('completeTask', () => {
    test('completes assigned task and records success', () => {
      router.createTask('t1', 'x', ['a']);
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.5 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      router.assignTask('t1');
      expect(router.completeTask('t1', { result: 'done' }, 200)).toBe(true);
      const task = router.getTask('t1')!;
      expect(task.status).toBe('completed');
      expect(task.result).toEqual({ result: 'done' });
      expect(reg.getPeer('p1')!.status).toBe('online');
      expect(reg.getPeer('p1')!.successRate).toBeGreaterThan(0.5);
    });

    test('rejects completion of unassigned task', () => {
      router.createTask('t1', 'x', ['a']);
      expect(router.completeTask('t1', 'ok', 100)).toBe(false);
    });

    test('rejects completion of non-existent task', () => {
      expect(router.completeTask('nope', 'ok', 100)).toBe(false);
    });
  });

  describe('failTask', () => {
    test('marks task as failed and records failure', () => {
      router.createTask('t1', 'x', ['a']);
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.8 }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      router.assignTask('t1');
      expect(router.failTask('t1', 'timeout', 5000)).toBe(true);
      const task = router.getTask('t1')!;
      expect(task.status).toBe('failed');
      expect(task.error).toBe('timeout');
      expect(reg.getPeer('p1')!.status).toBe('online');
      expect(reg.getPeer('p1')!.successRate).toBeLessThan(0.8);
    });
  });

  describe('getExpiredTasks', () => {
    test('finds tasks past timeout', () => {
      router = new TaskRouter(reg, { taskTimeoutMs: 100 });
      router.createTask('t1', 'x', ['a']);
      // Manually backdate
      const task = router.getTask('t1')!;
      task.createdAt = Date.now() - 200;
      const expired = router.getExpiredTasks();
      expect(expired.map(t => t.id)).toEqual(['t1']);
    });

    test('ignores non-expired tasks', () => {
      router = new TaskRouter(reg, { taskTimeoutMs: 60000 });
      router.createTask('t1', 'x', ['a']);
      expect(router.getExpiredTasks()).toEqual([]);
    });

    test('ignores completed tasks even if old', () => {
      router = new TaskRouter(reg, { taskTimeoutMs: 100 });
      const task = router.createTask('t1', 'x', ['a']);
      task.status = 'completed';
      task.createdAt = Date.now() - 200;
      expect(router.getExpiredTasks()).toEqual([]);
    });
  });

  describe('autoAssign', () => {
    test('assigns tasks with minimum bids', () => {
      router.createTask('t1', 'x', ['a']);
      router.createTask('t2', 'x', ['b']);
      reg.upsertPeer(makePeer({ id: 'p1' }));
      reg.upsertPeer(makePeer({ id: 'p2' }));
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      // t2 has no bid
      const results = router.autoAssign(1);
      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('t1');
    });

    test('respects minBids threshold', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      const results = router.autoAssign(2); // need at least 2 bids
      expect(results).toHaveLength(0);
    });
  });

  describe('getTasksByStatus', () => {
    test('filters tasks by status', () => {
      router.createTask('t1', 'x', ['a']);
      router.createTask('t2', 'x', ['b']);
      router.createTask('t3', 'x', ['c']);
      router.getTask('t2')!.status = 'completed';
      router.getTask('t3')!.status = 'failed';
      expect(router.getTasksByStatus('pending')).toHaveLength(1);
      expect(router.getTasksByStatus('completed')).toHaveLength(1);
      expect(router.getTasksByStatus('failed')).toHaveLength(1);
    });
  });

  describe('clearTasks', () => {
    test('removes all tasks', () => {
      router.createTask('t1', 'x', ['a']);
      router.createTask('t2', 'x', ['b']);
      router.clearTasks();
      expect(router.taskCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('single bid is auto-assigned', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1', confidence: 0.1, load: 0.9 }));
      const d = router.evaluateBids('t1');
      expect(d.winner).toBe('p1');
      expect(d.score).toBeGreaterThan(0);
    });

    test('handles unknown peer in bid (no crash)', () => {
      router.createTask('t1', 'x', ['a']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'ghost', confidence: 0.5 }));
      expect(() => router.evaluateBids('t1')).not.toThrow();
    });

    test('task lifecycle: create → bid → assign → complete', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['x'] }));
      router.createTask('t1', 'x', ['x']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      router.assignTask('t1');
      router.completeTask('t1', 'result', 100);
      const task = router.getTask('t1')!;
      expect(task.status).toBe('completed');
      expect(task.assignedTo).toBe('p1');
    });

    test('task lifecycle: create → bid → assign → fail', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['x'] }));
      router.createTask('t1', 'x', ['x']);
      router.submitBid(makeBid({ taskId: 't1', nodeId: 'p1' }));
      router.assignTask('t1');
      router.failTask('t1', 'OOM', 5000);
      const task = router.getTask('t1')!;
      expect(task.status).toBe('failed');
      expect(task.error).toBe('OOM');
    });
  });
});
