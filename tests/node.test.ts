/**
 * Tests for MeshNetworkNode — pure logic tests (no libp2p networking required).
 *
 * The MeshNetworkNode class delegates heavily to libp2p for transport,
 * but several methods contain pure logic that can be tested in isolation:
 *   - Constructor config merging
 *   - registerCapability() map management
 *   - getKnownPeers() / getStats() accessors
 *   - Message type routing (handleMessage dispatch)
 *   - Capability advertisement format
 */

import { MeshNetworkNode, MeshConfig, Task, TaskResult, TaskBid, MeshMessage } from '../src/core/node';

describe('MeshNetworkNode', () => {
  describe('constructor', () => {
    test('creates instance with default config', () => {
      const node = new MeshNetworkNode();
      expect(node).toBeInstanceOf(MeshNetworkNode);
      expect(node.nodeId).toBe('unknown'); // libp2p not started
    });

    test('accepts custom listenAddresses', () => {
      const node = new MeshNetworkNode({
        listenAddresses: ['/ip4/127.0.0.1/tcp/4001'],
      });
      expect(node).toBeDefined();
    });

    test('accepts custom capabilities list', () => {
      const node = new MeshNetworkNode({
        capabilities: ['translation', 'summarization'],
      });
      expect(node).toBeDefined();
    });

    test('accepts bootstrapPeers', () => {
      const node = new MeshNetworkNode({
        bootstrapPeers: ['/ip4/10.0.0.1/tcp/4001/p2p/QmPeer'],
      });
      expect(node).toBeDefined();
    });

    test('accepts custom nodeId', () => {
      const node = new MeshNetworkNode({ nodeId: 'custom-node-1' });
      expect(node).toBeDefined();
    });
  });

  describe('registerCapability', () => {
    test('registers a capability handler', () => {
      const node = new MeshNetworkNode();
      const handler = jest.fn().mockResolvedValue('result');
      node.registerCapability('translation', handler);
      // getStats reflects the registered capability
      const stats = node.getStats();
      expect(stats.capabilities).toBe(1);
    });

    test('registers multiple capabilities', () => {
      const node = new MeshNetworkNode();
      node.registerCapability('translation', jest.fn());
      node.registerCapability('summarization', jest.fn());
      node.registerCapability('code-review', jest.fn());
      expect(node.getStats().capabilities).toBe(3);
    });

    test('overwrites capability when re-registered with same name', () => {
      const node = new MeshNetworkNode();
      const handler1 = jest.fn().mockResolvedValue('a');
      const handler2 = jest.fn().mockResolvedValue('b');
      node.registerCapability('task', handler1);
      node.registerCapability('task', handler2);
      expect(node.getStats().capabilities).toBe(1); // same key, overwritten
    });

    test('does not advertise when node not started (no throw)', () => {
      const node = new MeshNetworkNode();
      // registerCapability checks `if (this.libp2p)` before advertising.
      // Without libp2p, it should just store the capability without error.
      expect(() => {
        node.registerCapability('test', jest.fn());
      }).not.toThrow();
    });
  });

  describe('getStats', () => {
    test('returns zero counts for fresh node', () => {
      const node = new MeshNetworkNode();
      const stats = node.getStats();
      expect(stats).toEqual({
        nodeId: 'unknown',
        peers: 0,
        capabilities: 0,
        pendingTasks: 0,
      });
    });

    test('reflects registered capabilities count', () => {
      const node = new MeshNetworkNode();
      node.registerCapability('a', jest.fn());
      node.registerCapability('b', jest.fn());
      const stats = node.getStats();
      expect(stats.capabilities).toBe(2);
    });

    test('nodeId is "unknown" before start', () => {
      const node = new MeshNetworkNode();
      expect(node.getStats().nodeId).toBe('unknown');
    });

    test('peers is 0 before start', () => {
      const node = new MeshNetworkNode();
      expect(node.getStats().peers).toBe(0);
    });
  });

  describe('getKnownPeers', () => {
    test('returns empty array for fresh node', () => {
      const node = new MeshNetworkNode();
      expect(node.getKnownPeers()).toEqual([]);
    });
  });

  describe('nodeId getter', () => {
    test('returns "unknown" when libp2p is not started', () => {
      const node = new MeshNetworkNode();
      expect(node.nodeId).toBe('unknown');
    });
  });

  describe('Task type interface', () => {
    test('Task can be constructed with required fields', () => {
      const task: Task = {
        id: 'task-001',
        type: 'translation',
        payload: { text: 'hello' },
      };
      expect(task.id).toBe('task-001');
      expect(task.type).toBe('translation');
    });

    test('Task supports optional fields', () => {
      const task: Task = {
        id: 'task-002',
        type: 'code-review',
        payload: {},
        requiredCapabilities: ['rust', 'security'],
        timeout: 30000,
        priority: 'high',
      };
      expect(task.requiredCapabilities).toEqual(['rust', 'security']);
      expect(task.timeout).toBe(30000);
      expect(task.priority).toBe('high');
    });

    test('Task priority values', () => {
      const priorities: Array<Task['priority']> = ['low', 'normal', 'high'];
      expect(priorities).toHaveLength(3);
    });
  });

  describe('TaskResult type interface', () => {
    test('successful TaskResult', () => {
      const result: TaskResult = {
        taskId: 'task-001',
        nodeId: 'node-A',
        success: true,
        result: { translated: 'hola' },
        executionTime: 150,
      };
      expect(result.success).toBe(true);
    });

    test('failed TaskResult', () => {
      const result: TaskResult = {
        taskId: 'task-002',
        nodeId: 'node-B',
        success: false,
        error: 'Capability not available',
        executionTime: 5,
      };
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('TaskBid type interface', () => {
    test('TaskBid can be constructed', () => {
      const bid: TaskBid = {
        taskId: 'task-001',
        nodeId: 'node-A',
        estimatedTime: 5000,
        confidence: 0.9,
        load: 0.3,
      };
      expect(bid.taskId).toBe('task-001');
      expect(bid.confidence).toBeGreaterThan(0);
      expect(bid.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('MeshMessage type interface', () => {
    test('constructs a task_request message', () => {
      const msg: MeshMessage = {
        id: 'msg-001',
        from: 'node-A',
        type: 'task_request',
        payload: { id: 'task-001', type: 'translation', payload: {} },
        timestamp: Date.now(),
        ttl: 10,
      };
      expect(msg.type).toBe('task_request');
    });

    test('constructs a heartbeat message', () => {
      const msg: MeshMessage = {
        id: 'msg-002',
        from: 'node-A',
        type: 'heartbeat',
        payload: { timestamp: Date.now(), load: 0.1 },
        timestamp: Date.now(),
        ttl: 3,
      };
      expect(msg.type).toBe('heartbeat');
    });

    test('constructs a capability_ad message', () => {
      const msg: MeshMessage = {
        id: 'msg-003',
        from: 'node-A',
        type: 'capability_ad',
        payload: {
          capabilities: ['code-review', 'translation'],
          nodeId: 'node-A',
          addresses: [],
        },
        timestamp: Date.now(),
        ttl: 5,
      };
      expect(msg.type).toBe('capability_ad');
    });

    test('constructs a directed message (with "to")', () => {
      const msg: MeshMessage = {
        id: 'msg-004',
        from: 'node-A',
        to: 'node-B',
        type: 'task_response',
        payload: {},
        timestamp: Date.now(),
        ttl: 5,
      };
      expect(msg.to).toBe('node-B');
    });
  });

  describe('MeshConfig defaults', () => {
    test('default config merges correctly', () => {
      // The constructor uses defaults: listenAddresses ['/ip4/0.0.0.0/tcp/0'],
      // bootstrapPeers: [], capabilities: []
      const node = new MeshNetworkNode();
      // We verify indirectly through stats — no crash means config was applied
      expect(node.getStats()).toBeDefined();
    });

    test('empty config object is valid', () => {
      const node = new MeshNetworkNode({});
      expect(node).toBeDefined();
    });

    test('null config uses defaults', () => {
      // Constructor signature: config: MeshConfig = {}
      // Passing undefined triggers default
      const node = new MeshNetworkNode(undefined as any);
      expect(node).toBeDefined();
    });
  });

  describe('EventEmitter behavior', () => {
    test('MeshNetworkNode extends EventEmitter', () => {
      const { EventEmitter } = require('events');
      const node = new MeshNetworkNode();
      expect(node).toBeInstanceOf(EventEmitter);
    });

    test('can add event listeners', () => {
      const node = new MeshNetworkNode();
      const callback = jest.fn();
      node.on('error', callback);
      node.emit('error', new Error('test'));
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    test('can emit task:result events', () => {
      const node = new MeshNetworkNode();
      const results: TaskResult[] = [];
      node.on('task:result', (r: TaskResult) => results.push(r));
      node.emit('task:result', {
        taskId: 't1',
        nodeId: 'n1',
        success: true,
        executionTime: 100,
      });
      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('t1');
    });

    test('can emit peer:discovered events', () => {
      const node = new MeshNetworkNode();
      let discovered: any = null;
      node.on('peer:discovered', (peer: any) => { discovered = peer; });
      const fakePeer = {
        id: 'peer-1',
        publicKey: '',
        capabilities: ['summarization'],
        status: 'online',
        lastSeen: Date.now(),
        addresses: ['/ip4/1.2.3.4/tcp/4001'],
        peers: [],
      };
      node.emit('peer:discovered', fakePeer);
      expect(discovered).toEqual(fakePeer);
    });
  });

  describe('stop without start', () => {
    test('stop() handles gracefully when never started', async () => {
      const node = new MeshNetworkNode();
      // libp2p is null, stop should not throw
      await expect(node.stop()).resolves.not.toThrow();
    });
  });

  describe('connect before start', () => {
    test('connect() throws when node not started', async () => {
      const node = new MeshNetworkNode();
      await expect(node.connect('/ip4/127.0.0.1/tcp/4001'))
        .rejects.toThrow('Node not started');
    });
  });

  describe('publishTask before start', () => {
    test('publishTask() throws when node not started', async () => {
      const node = new MeshNetworkNode();
      const task: Task = {
        id: 'task-001',
        type: 'translation',
        payload: {},
      };
      await expect(node.publishTask(task)).rejects.toThrow('Node not started');
    });
  });
});
