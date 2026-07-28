import { MeshNetworkNode, Task, TaskResult, TaskBid, MeshMessage } from '../src/core/node';

describe('TaskBid comprehensive interface', () => {
  describe('TaskBid construction and fields', () => {
    it('constructs a minimal valid TaskBid', () => {
      const bid: TaskBid = {
        taskId: 'task-001',
        nodeId: 'node-A',
        estimatedTime: 3000,
        confidence: 0.85,
        load: 0.2,
      };
      expect(bid.taskId).toBe('task-001');
      expect(bid.nodeId).toBe('node-A');
      expect(bid.estimatedTime).toBe(3000);
      expect(bid.confidence).toBe(0.85);
      expect(bid.load).toBe(0.2);
    });

    it('supports zero estimatedTime for instant tasks', () => {
      const bid: TaskBid = {
        taskId: 't0',
        nodeId: 'n0',
        estimatedTime: 0,
        confidence: 1.0,
        load: 0,
      };
      expect(bid.estimatedTime).toBe(0);
    });

    it('supports maximum confidence value of 1', () => {
      const bid: TaskBid = {
        taskId: 't1',
        nodeId: 'n1',
        estimatedTime: 1000,
        confidence: 1.0,
        load: 0.5,
      };
      expect(bid.confidence).toBe(1.0);
    });

    it('supports zero confidence for exploratory bids', () => {
      const bid: TaskBid = {
        taskId: 't2',
        nodeId: 'n2',
        estimatedTime: 9999,
        confidence: 0,
        load: 0.9,
      };
      expect(bid.confidence).toBe(0);
    });

    it('supports very high load values', () => {
      const bid: TaskBid = {
        taskId: 't3',
        nodeId: 'n3',
        estimatedTime: 5000,
        confidence: 0.3,
        load: 0.99,
      };
      expect(bid.load).toBeGreaterThan(0.9);
    });
  });

  describe('TaskBid comparison scenarios', () => {
    it('can compare confidence between bids', () => {
      const bids: TaskBid[] = [
        { taskId: 't', nodeId: 'low', estimatedTime: 5000, confidence: 0.3, load: 0.8 },
        { taskId: 't', nodeId: 'high', estimatedTime: 2000, confidence: 0.9, load: 0.1 },
        { taskId: 't', nodeId: 'mid', estimatedTime: 3000, confidence: 0.6, load: 0.5 },
      ];
      const sorted = [...bids].sort((a, b) => b.confidence - a.confidence);
      expect(sorted[0].nodeId).toBe('high');
      expect(sorted[sorted.length - 1].nodeId).toBe('low');
    });

    it('can compare load between bids', () => {
      const bids: TaskBid[] = [
        { taskId: 't', nodeId: 'busy', estimatedTime: 5000, confidence: 0.5, load: 0.9 },
        { taskId: 't', nodeId: 'idle', estimatedTime: 3000, confidence: 0.5, load: 0.1 },
      ];
      const leastLoaded = [...bids].sort((a, b) => a.load - b.load)[0];
      expect(leastLoaded.nodeId).toBe('idle');
    });

    it('can compare estimatedTime between bids', () => {
      const bids: TaskBid[] = [
        { taskId: 't', nodeId: 'slow', estimatedTime: 10000, confidence: 0.8, load: 0.3 },
        { taskId: 't', nodeId: 'fast', estimatedTime: 500, confidence: 0.8, load: 0.3 },
      ];
      const fastest = [...bids].sort((a, b) => a.estimatedTime - b.estimatedTime)[0];
      expect(fastest.nodeId).toBe('fast');
    });

    it('can compute a composite score from bid fields', () => {
      const bid: TaskBid = {
        taskId: 't',
        nodeId: 'n',
        estimatedTime: 3000,
        confidence: 0.8,
        load: 0.2,
      };
      // Higher is better: confidence * (1 - load) / estimatedTime
      const score = (bid.confidence * (1 - bid.load)) / bid.estimatedTime;
      expect(score).toBeCloseTo(0.8 * 0.8 / 3000, 5);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('TaskBid array operations', () => {
    const sampleBids: TaskBid[] = [
      { taskId: 't1', nodeId: 'n1', estimatedTime: 1000, confidence: 0.9, load: 0.1 },
      { taskId: 't2', nodeId: 'n2', estimatedTime: 2000, confidence: 0.5, load: 0.5 },
      { taskId: 't3', nodeId: 'n3', estimatedTime: 3000, confidence: 0.3, load: 0.8 },
    ];

    it('can filter bids by confidence threshold', () => {
      const high = sampleBids.filter(b => b.confidence > 0.7);
      expect(high).toHaveLength(1);
      expect(high[0].nodeId).toBe('n1');
    });

    it('can filter bids by load threshold', () => {
      const available = sampleBids.filter(b => b.load < 0.6);
      expect(available).toHaveLength(2);
    });

    it('can find the best bid by composite score', () => {
      const scored = sampleBids.map(b => ({
        bid: b,
        score: b.confidence * (1 - b.load) / (b.estimatedTime / 1000),
      }));
      const best = scored.sort((a, b) => b.score - a.score)[0];
      expect(best.bid.nodeId).toBe('n1');
    });

    it('can group bids by taskId', () => {
      const grouped: Record<string, TaskBid[]> = {};
      for (const b of sampleBids) {
        (grouped[b.taskId] ??= []).push(b);
      }
      expect(Object.keys(grouped)).toHaveLength(3);
      expect(grouped['t1']).toHaveLength(1);
    });
  });
});

describe('TaskResult comprehensive interface', () => {
  describe('successful results', () => {
    it('constructs a successful result with data', () => {
      const result: TaskResult = {
        taskId: 't1',
        nodeId: 'n1',
        success: true,
        result: { answer: 42 },
        executionTime: 150,
      };
      expect(result.success).toBe(true);
      expect(result.result.answer).toBe(42);
      expect(result.error).toBeUndefined();
    });

    it('supports null result in successful task', () => {
      const result: TaskResult = {
        taskId: 't2',
        nodeId: 'n2',
        success: true,
        result: null,
        executionTime: 50,
      };
      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });

    it('supports complex nested result objects', () => {
      const result: TaskResult = {
        taskId: 't3',
        nodeId: 'n3',
        success: true,
        result: {
          level1: {
            level2: {
              level3: 'deep value',
            },
            array: [1, 2, 3],
          },
        },
        executionTime: 300,
      };
      expect(result.result.level1.level2.level3).toBe('deep value');
      expect(result.result.level1.array).toHaveLength(3);
    });

    it('supports array as direct result', () => {
      const result: TaskResult = {
        taskId: 't4',
        nodeId: 'n4',
        success: true,
        result: [1, 2, 3, 4, 5],
        executionTime: 10,
      };
      expect(Array.isArray(result.result)).toBe(true);
      expect(result.result).toHaveLength(5);
    });

    it('supports string as direct result', () => {
      const result: TaskResult = {
        taskId: 't5',
        nodeId: 'n5',
        success: true,
        result: 'completed',
        executionTime: 5,
      };
      expect(result.result).toBe('completed');
    });

    it('supports zero executionTime', () => {
      const result: TaskResult = {
        taskId: 't6',
        nodeId: 'n6',
        success: true,
        executionTime: 0,
      };
      expect(result.executionTime).toBe(0);
    });
  });

  describe('failed results', () => {
    it('constructs a failed result with error message', () => {
      const result: TaskResult = {
        taskId: 't-fail',
        nodeId: 'n1',
        success: false,
        error: 'Connection timeout',
        executionTime: 60000,
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
      expect(result.result).toBeUndefined();
    });

    it('supports empty error string', () => {
      const result: TaskResult = {
        taskId: 't-fail2',
        nodeId: 'n2',
        success: false,
        error: '',
        executionTime: 100,
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('');
    });

    it('supports multi-line error messages', () => {
      const result: TaskResult = {
        taskId: 't-fail3',
        nodeId: 'n3',
        success: false,
        error: 'Line 1\nLine 2\nLine 3',
        executionTime: 200,
      };
      expect(result.error?.split('\n')).toHaveLength(3);
    });
  });

  describe('TaskResult array operations', () => {
    const results: TaskResult[] = [
      { taskId: 't1', nodeId: 'n1', success: true, result: 'ok', executionTime: 100 },
      { taskId: 't2', nodeId: 'n2', success: false, error: 'fail', executionTime: 200 },
      { taskId: 't3', nodeId: 'n3', success: true, result: 'ok', executionTime: 50 },
      { taskId: 't4', nodeId: 'n4', success: false, error: 'timeout', executionTime: 60000 },
    ];

    it('can partition by success', () => {
      const success = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      expect(success).toHaveLength(2);
      expect(failed).toHaveLength(2);
    });

    it('can find fastest successful result', () => {
      const fastest = results
        .filter(r => r.success)
        .sort((a, b) => a.executionTime - b.executionTime)[0];
      expect(fastest.executionTime).toBe(50);
    });

    it('can compute average execution time', () => {
      const avg = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
      expect(avg).toBeCloseTo((100 + 200 + 50 + 60000) / 4, 0);
    });

    it('can find all errors from failed results', () => {
      const errors = results.filter(r => !r.success).map(r => r.error);
      expect(errors).toEqual(['fail', 'timeout']);
    });
  });
});

describe('Task priority and timeout edge cases', () => {
  describe('Task priority ordering', () => {
    it('low priority task', () => {
      const task: Task = {
        id: 'low',
        type: 'compute',
        payload: {},
        priority: 'low',
      };
      expect(task.priority).toBe('low');
    });

    it('normal priority task (default when omitted)', () => {
      const task: Task = {
        id: 'normal',
        type: 'compute',
        payload: {},
      };
      expect(task.priority).toBeUndefined();
    });

    it('high priority task', () => {
      const task: Task = {
        id: 'high',
        type: 'compute',
        payload: {},
        priority: 'high',
      };
      expect(task.priority).toBe('high');
    });

    it('can sort tasks by priority', () => {
      const priorityOrder = { low: 0, normal: 1, high: 2 };
      const tasks: Task[] = [
        { id: 't1', type: 'x', payload: {}, priority: 'low' },
        { id: 't2', type: 'x', payload: {}, priority: 'high' },
        { id: 't3', type: 'x', payload: {}, priority: 'normal' as any },
      ];
      const sorted = [...tasks].sort((a, b) =>
        (priorityOrder[b.priority || 'normal'] ?? 1) - (priorityOrder[a.priority || 'normal'] ?? 1)
      );
      expect(sorted[0].id).toBe('t2');
      expect(sorted[sorted.length - 1].id).toBe('t1');
    });
  });

  describe('Task timeout edge cases', () => {
    it('default timeout is undefined (node will use its default)', () => {
      const task: Task = { id: 't', type: 'x', payload: {} };
      expect(task.timeout).toBeUndefined();
    });

    it('supports zero timeout meaning immediate expiry', () => {
      const task: Task = { id: 't0', type: 'x', payload: {}, timeout: 0 };
      expect(task.timeout).toBe(0);
    });

    it('supports very long timeout', () => {
      const task: Task = { id: 't-long', type: 'x', payload: {}, timeout: 86400000 };
      expect(task.timeout).toBe(86400000);
    });

    it('supports fractional timeout in milliseconds', () => {
      const task: Task = { id: 't-frac', type: 'x', payload: {}, timeout: 0.5 };
      expect(task.timeout).toBeLessThan(1);
    });
  });

  describe('Task requiredCapabilities', () => {
    it('supports single required capability', () => {
      const task: Task = {
        id: 't',
        type: 'compute',
        payload: {},
        requiredCapabilities: ['gpu'],
      };
      expect(task.requiredCapabilities).toEqual(['gpu']);
    });

    it('supports multiple required capabilities', () => {
      const task: Task = {
        id: 't',
        type: 'compute',
        payload: {},
        requiredCapabilities: ['gpu', 'memory', 'storage'],
      };
      expect(task.requiredCapabilities).toHaveLength(3);
    });

    it('supports empty required capabilities array', () => {
      const task: Task = {
        id: 't',
        type: 'compute',
        payload: {},
        requiredCapabilities: [],
      };
      expect(task.requiredCapabilities).toHaveLength(0);
    });

    it('requiredCapabilities defaults to undefined', () => {
      const task: Task = { id: 't', type: 'compute', payload: {} };
      expect(task.requiredCapabilities).toBeUndefined();
    });
  });
});

describe('MeshMessage serialization round-trip', () => {
  it('can serialize and parse a task_request message', () => {
    const msg: MeshMessage = {
      id: 'msg-001',
      from: 'node-A',
      type: 'task_request',
      payload: { id: 'task-1', type: 'compute', payload: { n: 42 } },
      timestamp: Date.now(),
      ttl: 10,
    };
    const json = JSON.stringify(msg);
    const parsed: MeshMessage = JSON.parse(json);
    expect(parsed.id).toBe(msg.id);
    expect(parsed.from).toBe(msg.from);
    expect(parsed.type).toBe('task_request');
    expect(parsed.payload.payload.n).toBe(42);
    expect(parsed.ttl).toBe(10);
  });

  it('can serialize a signed message', () => {
    const msg: MeshMessage = {
      id: 'msg-002',
      from: 'node-B',
      to: 'node-A',
      type: 'task_response',
      payload: { success: true },
      timestamp: Date.now(),
      ttl: 5,
      signature: '0xabc123',
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.signature).toBe('0xabc123');
    expect(parsed.to).toBe('node-A');
  });

  it('can serialize a heartbeat with nested payload', () => {
    const msg: MeshMessage = {
      id: 'msg-003',
      from: 'node-C',
      type: 'heartbeat',
      payload: { timestamp: 1700000000, load: 0.3 },
      timestamp: 1700000000,
      ttl: 3,
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.payload.load).toBe(0.3);
  });

  it('serializes all MessageType variants correctly', () => {
    const types = ['task_request', 'task_response', 'task_bid', 'capability_ad', 'peer_list', 'gossip', 'heartbeat'];
    for (const type of types) {
      const msg: MeshMessage = {
        id: `msg-${type}`,
        from: 'node',
        type: type as any,
        payload: {},
        timestamp: Date.now(),
        ttl: 1,
      };
      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe(type);
    }
  });
});

describe('MeshNetworkNode pending task tracking', () => {
  it('getStats reflects zero pendingTasks for fresh node', () => {
    const node = new MeshNetworkNode();
    const stats = node.getStats();
    expect(stats.pendingTasks).toBe(0);
  });

  it('getStats pendingTasks remains 0 after registering capabilities (pre-start)', () => {
    const node = new MeshNetworkNode();
    node.registerCapability('task-a', async () => 'result-a');
    node.registerCapability('task-b', async () => 'result-b');
    node.registerCapability('task-c', async () => 'result-c');
    expect(node.getStats().pendingTasks).toBe(0);
    expect(node.getStats().capabilities).toBe(3);
  });
});

describe('MeshNetworkNode registerCapability stress patterns', () => {
  it('can register 50 capabilities rapidly', () => {
    const node = new MeshNetworkNode();
    for (let i = 0; i < 50; i++) {
      node.registerCapability(`cap-${i}`, async () => i);
    }
    expect(node.getStats().capabilities).toBe(50);
  });

  it('overwriting same capability name 100 times keeps count at 1', () => {
    const node = new MeshNetworkNode();
    for (let i = 0; i < 100; i++) {
      node.registerCapability('same-cap', async () => i);
    }
    expect(node.getStats().capabilities).toBe(1);
  });

  it('registering then overwriting then adding new keeps accurate count', () => {
    const node = new MeshNetworkNode();
    node.registerCapability('a', async () => 1);
    node.registerCapability('b', async () => 2);
    node.registerCapability('a', async () => 3); // overwrite
    node.registerCapability('c', async () => 4); // new
    expect(node.getStats().capabilities).toBe(3);
  });
});

describe('MeshNode interface (peer info)', () => {
  it('constructs a full MeshNode with all fields', () => {
    const node_info = {
      id: '12D3KooW...',
      publicKey: '0x04abc...',
      capabilities: ['compute', 'storage'],
      status: 'online' as const,
      lastSeen: Date.now(),
      addresses: ['/ip4/1.2.3.4/tcp/4001'],
      peers: ['12D3KooW...peer1', '12D3KooW...peer2'],
    };
    expect(node_info.status).toBe('online');
    expect(node_info.capabilities).toHaveLength(2);
    expect(node_info.peers).toHaveLength(2);
  });

  it('supports busy status', () => {
    const node_info = {
      id: 'busy-node',
      publicKey: '',
      capabilities: [],
      status: 'busy' as const,
      lastSeen: Date.now(),
      addresses: [],
      peers: [],
    };
    expect(node_info.status).toBe('busy');
  });

  it('supports offline status', () => {
    const node_info = {
      id: 'offline-node',
      publicKey: '',
      capabilities: [],
      status: 'offline' as const,
      lastSeen: 0,
      addresses: [],
      peers: [],
    };
    expect(node_info.status).toBe('offline');
  });
});
