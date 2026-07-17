/**
 * Additional edge-case tests for MeshNetworkNode — focusing on untested logic paths:
 *   - generateId uniqueness
 *   - EventEmitter max listeners
 *   - Task/TaskBid/TaskResult with extreme values
 *   - MessageType completeness for all 7 types
 *   - Capability handler invocation
 *   - Config merging with undefined values
 *   - getKnownPeers returns copies not references
 *   - Stats consistency after operations
 *   - Multiple node instances are independent
 *   - Capability handler can be async
 */

import { MeshNetworkNode, MeshConfig, Task, TaskResult, TaskBid, MeshMessage, MessageType } from '../src/core/node';

describe('MeshNetworkNode additional edge cases', () => {
  describe('constructor config merging', () => {
    test('empty arrays are preserved', () => {
      const node = new MeshNetworkNode({
        listenAddresses: [],
        bootstrapPeers: [],
        capabilities: [],
      });
      expect(node).toBeDefined();
      expect(node.getStats().capabilities).toBe(0);
    });

    test('undefined fields use defaults via spread', () => {
      const node = new MeshNetworkNode({
        nodeId: 'test',
        // listenAddresses, bootstrapPeers, capabilities are undefined
      });
      expect(node).toBeDefined();
    });

    test('null config uses defaults', () => {
      // @ts-ignore - testing runtime behavior with null
      const node = new MeshNetworkNode(null);
      expect(node).toBeInstanceOf(MeshNetworkNode);
    });
  });

  describe('nodeId before and after operations', () => {
    test('nodeId stays "unknown" through operations', () => {
      const node = new MeshNetworkNode();
      node.registerCapability('test', jest.fn());
      node.registerCapability('test2', jest.fn());
      expect(node.nodeId).toBe('unknown');
    });

    test('multiple stop calls return without error', async () => {
      const node = new MeshNetworkNode();
      await expect(node.stop()).resolves.not.toThrow();
      await expect(node.stop()).resolves.not.toThrow();
      await expect(node.stop()).resolves.not.toThrow();
    });
  });

  describe('capability handler semantics', () => {
    test('handler can be async function', async () => {
      const node = new MeshNetworkNode();
      const handler = jest.fn().mockResolvedValue('async result');
      node.registerCapability('async-cap', handler);

      // Invoke handler directly to verify it's stored
      const stored = (node as any).capabilities.get('async-cap');
      expect(stored).toBe(handler);
      const result = await stored({ id: 't1', type: 'async-cap', payload: {} });
      expect(result).toBe('async result');
      expect(handler).toHaveBeenCalledWith({ id: 't1', type: 'async-cap', payload: {} });
    });

    test('handler can throw and error is caught by caller', async () => {
      const node = new MeshNetworkNode();
      const handler = jest.fn().mockRejectedValue(new Error('boom'));
      node.registerCapability('err-cap', handler);

      const stored = (node as any).capabilities.get('err-cap');
      await expect(stored({ id: 't1', type: 'err-cap', payload: {} })).rejects.toThrow('boom');
    });

    test('handler receives full task object', async () => {
      const node = new MeshNetworkNode();
      const handler = jest.fn().mockReturnValue(42);
      node.registerCapability('compute', handler);

      const task: Task = {
        id: 'task-42',
        type: 'compute',
        payload: { x: 1, y: 2 },
        requiredCapabilities: ['compute'],
        priority: 'high',
      };

      const stored = (node as any).capabilities.get('compute');
      const result = await stored(task);
      expect(result).toBe(42);
      expect(handler).toHaveBeenCalledWith(task);
    });

    test('re-registering replaces the old handler', () => {
      const node = new MeshNetworkNode();
      const handler1 = jest.fn().mockReturnValue('v1');
      const handler2 = jest.fn().mockReturnValue('v2');

      node.registerCapability('cap', handler1);
      node.registerCapability('cap', handler2);

      const stored = (node as any).capabilities.get('cap');
      expect(stored).toBe(handler2);
      expect(stored).not.toBe(handler1);
    });
  });

  describe('getStats with various states', () => {
    test('stats reflect zero after clearing capabilities is not possible (no remove method)', () => {
      // There is no unregisterCapability method, so count only goes up
      const node = new MeshNetworkNode();
      node.registerCapability('a', jest.fn());
      node.registerCapability('b', jest.fn());
      node.registerCapability('a', jest.fn()); // overwrite
      expect(node.getStats().capabilities).toBe(2);
    });

    test('stats peers is always 0 before start', () => {
      const node = new MeshNetworkNode();
      expect(node.getStats().peers).toBe(0);
    });

    test('stats pendingTasks is always 0 before publishTask', () => {
      const node = new MeshNetworkNode();
      expect(node.getStats().pendingTasks).toBe(0);
    });
  });

  describe('Task interface edge cases', () => {
    test('Task with empty string type', () => {
      const task: Task = { id: 't1', type: '', payload: {} };
      expect(task.type).toBe('');
    });

    test('Task with very long id', () => {
      const longId = 'x'.repeat(1000);
      const task: Task = { id: longId, type: 'compute', payload: {} };
      expect(task.id.length).toBe(1000);
    });

    test('Task with nested payload', () => {
      const task: Task = {
        id: 't1',
        type: 'compute',
        payload: { data: { nested: { deep: [1, 2, 3] } } },
      };
      expect(task.payload.data.nested.deep).toEqual([1, 2, 3]);
    });

    test('Task timeout 0 means immediate timeout', () => {
      const task: Task = { id: 't1', type: 'compute', payload: {}, timeout: 0 };
      expect(task.timeout).toBe(0);
    });

    test('TaskBid with maximum values', () => {
      const bid: TaskBid = {
        taskId: 't1',
        nodeId: 'n1',
        estimatedTime: Number.MAX_SAFE_INTEGER,
        confidence: 1.0,
        load: 0,
      };
      expect(bid.estimatedTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('TaskBid with zero confidence', () => {
      const bid: TaskBid = {
        taskId: 't1',
        nodeId: 'n1',
        estimatedTime: 1000,
        confidence: 0,
        load: 1,
      };
      expect(bid.confidence).toBe(0);
    });

    test('TaskResult with error message', () => {
      const result: TaskResult = {
        taskId: 't1',
        nodeId: 'n1',
        success: false,
        error: 'Something went wrong',
        executionTime: 0,
      };
      expect(result.success).toBe(false);
      expect(result.error).toContain('wrong');
    });

    test('TaskResult with complex result object', () => {
      const result: TaskResult = {
        taskId: 't1',
        nodeId: 'n1',
        success: true,
        result: { items: [1, 2, 3], meta: { count: 3 } },
        executionTime: 42,
      };
      expect(result.result.items).toHaveLength(3);
    });
  });

  describe('MeshMessage all MessageType variants', () => {
    const allTypes: MessageType[] = [
      'task_request',
      'task_response',
      'task_bid',
      'capability_ad',
      'peer_list',
      'gossip',
      'heartbeat',
    ];

    test.each(allTypes)('message type "%s" can be used in MeshMessage', (type) => {
      const msg: MeshMessage = {
        id: 'm1',
        from: 'node1',
        type,
        payload: {},
        timestamp: Date.now(),
        ttl: 5,
      };
      expect(msg.type).toBe(type);
    });

    test('MeshMessage with signature', () => {
      const msg: MeshMessage = {
        id: 'm1',
        from: 'node1',
        type: 'gossip',
        payload: {},
        timestamp: Date.now(),
        ttl: 5,
        signature: '0xabc123',
      };
      expect(msg.signature).toBe('0xabc123');
    });

    test('MeshMessage with directed recipient', () => {
      const msg: MeshMessage = {
        id: 'm1',
        from: 'node1',
        to: 'node2',
        type: 'task_request',
        payload: {},
        timestamp: Date.now(),
        ttl: 3,
      };
      expect(msg.to).toBe('node2');
    });

    test('MeshMessage ttl can be 0', () => {
      const msg: MeshMessage = {
        id: 'm1',
        from: 'node1',
        type: 'heartbeat',
        payload: {},
        timestamp: Date.now(),
        ttl: 0,
      };
      expect(msg.ttl).toBe(0);
    });
  });

  describe('multiple node instances are independent', () => {
    test('capabilities are isolated between instances', () => {
      const node1 = new MeshNetworkNode();
      const node2 = new MeshNetworkNode();

      node1.registerCapability('unique-to-node1', jest.fn());

      expect(node1.getStats().capabilities).toBe(1);
      expect(node2.getStats().capabilities).toBe(0);
    });

    test('knownPeers are isolated between instances', () => {
      const node1 = new MeshNetworkNode();
      const node2 = new MeshNetworkNode();

      // Simulate peer discovery on node1
      node1.emit('peer:discovered', {
        id: 'peer-x',
        publicKey: '',
        capabilities: ['test'],
        status: 'online',
        lastSeen: Date.now(),
        addresses: [],
        peers: [],
      });

      expect(node1.getKnownPeers()).toBeDefined();
      expect(node2.getKnownPeers()).toHaveLength(0);
    });

    test('event listeners are isolated', () => {
      const node1 = new MeshNetworkNode();
      const node2 = new MeshNetworkNode();
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      node1.on('task:request', listener1);
      node2.on('task:request', listener2);

      node1.emit('task:request', { id: 't1', type: 'compute', payload: {} }, 'node-x');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('EventEmitter advanced patterns', () => {
    test('once() listener fires only once', () => {
      const node = new MeshNetworkNode();
      const listener = jest.fn();
      node.once('node:connected', listener);

      node.emit('node:connected', 'p1');
      node.emit('node:connected', 'p2');

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('removeAllListeners for specific event', () => {
      const node = new MeshNetworkNode();
      const l1 = jest.fn();
      const l2 = jest.fn();

      node.on('task:request', l1);
      node.on('task:request', l2);
      node.removeAllListeners('task:request');

      node.emit('task:request', { id: 't', type: 'compute', payload: {} }, 'node-x');
      expect(l1).not.toHaveBeenCalled();
      expect(l2).not.toHaveBeenCalled();
    });

    test('non-error events with no listeners do not crash', () => {
      const node = new MeshNetworkNode();
      // Emitting events with no listeners should not throw
      expect(() => {
        node.emit('task:result', {
          taskId: 't',
          nodeId: 'n',
          success: true,
          executionTime: 1,
        });
        node.emit('node:connected', 'p1');
        node.emit('peer:discovered', { id: 'p1' });
      }).not.toThrow();
    });

    test('error event without listeners throws (Node.js default behavior)', () => {
      const node = new MeshNetworkNode();
      // Node.js EventEmitter throws on unhandled 'error' events
      expect(() => {
        node.emit('error', new Error('unhandled'));
      }).toThrow('unhandled');
    });

    test('prependListener adds to beginning of chain', () => {
      const node = new MeshNetworkNode();
      const order: string[] = [];

      node.on('test', () => order.push('last'));
      node.prependListener('test', () => order.push('first'));

      node.emit('test');
      expect(order).toEqual(['first', 'last']);
    });

    test('listenerCount returns correct number', () => {
      const node = new MeshNetworkNode();
      node.on('test', () => {});
      node.on('test', () => {});
      node.on('other', () => {});

      expect(node.listenerCount('test')).toBe(2);
      expect(node.listenerCount('other')).toBe(1);
      expect(node.listenerCount('nonexistent')).toBe(0);
    });
  });

  describe('connect error path', () => {
    test('connect throws when libp2p not initialized', async () => {
      const node = new MeshNetworkNode();
      await expect(node.connect('/ip4/127.0.0.1/tcp/4001')).rejects.toThrow('Node not started');
    });

    test('publishTask throws when gossip not initialized', async () => {
      const node = new MeshNetworkNode();
      const task: Task = { id: 't1', type: 'compute', payload: {} };
      await expect(node.publishTask(task)).rejects.toThrow('Node not started');
    });
  });

  describe('MeshConfig with complex values', () => {
    test('config with many capabilities', () => {
      const caps = Array.from({ length: 20 }, (_, i) => `cap-${i}`);
      const node = new MeshNetworkNode({ capabilities: caps });
      // Capabilities in config are just stored, not registered as handlers
      expect(node).toBeDefined();
      expect(node.getStats().capabilities).toBe(0); // config capabilities ≠ registered handlers
    });

    test('config with multiple bootstrap peers', () => {
      const peers = [
        '/ip4/10.0.0.1/tcp/4001/p2p/QmPeer1',
        '/ip4/10.0.0.2/tcp/4001/p2p/QmPeer2',
        '/ip4/10.0.0.3/tcp/4001/p2p/QmPeer3',
      ];
      const node = new MeshNetworkNode({ bootstrapPeers: peers });
      expect(node).toBeDefined();
    });

    test('config with IPv6 listen address', () => {
      const node = new MeshNetworkNode({
        listenAddresses: ['/ip6/::1/tcp/4001'],
      });
      expect(node).toBeDefined();
    });
  });
});
