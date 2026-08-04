import { MeshHealthCheck, DEFAULT_THRESHOLDS } from '../src/core/health-check';
import { CircuitBreaker } from '../src/core/circuit-breaker';
import { MeshRegistry } from '../src/core/registry';
import { TaskRouter } from '../src/core/router';
import { MessageBus } from '../src/core/bus';

describe('MeshHealthCheck', () => {
  let hc: MeshHealthCheck;
  let cb: CircuitBreaker;
  let registry: MeshRegistry;
  let router: TaskRouter;
  let bus: MessageBus;

  beforeEach(() => {
    hc = new MeshHealthCheck();
    cb = new CircuitBreaker();
    registry = new MeshRegistry();
    router = new TaskRouter(registry);
    bus = new MessageBus();
  });

  // --- Circuit breaker health ---

  test('no circuits → score 1.0', () => {
    const h = hc.circuitBreakerHealth(cb);
    expect(h.score).toBe(1.0);
    expect(h.details.total).toBe(0);
  });

  test('all closed → score 1.0', () => {
    cb.recordSuccess('p1');
    cb.recordSuccess('p2');
    const h = hc.circuitBreakerHealth(cb);
    expect(h.score).toBe(1.0);
    expect(h.details.closed).toBe(2);
  });

  test('half open → score 0.5', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1'); // open
    cb.recordSuccess('p2');
    const h = hc.circuitBreakerHealth(cb);
    expect(h.score).toBe(0.5); // 1 closed / 2 total
  });

  test('all open → score 0.0', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    for (let i = 0; i < 3; i++) cb.recordFailure('p2');
    const h = hc.circuitBreakerHealth(cb);
    expect(h.score).toBe(0.0);
  });

  // --- Registry health ---

  test('no peers → score 0.5 (neutral)', () => {
    const h = hc.registryHealth(registry);
    expect(h.score).toBe(0.5);
  });

  test('all online peers with high success → high score', () => {
    const now = Date.now();
    registry.upsertPeer({ id: 'p1', capabilities: ['a'], status: 'online', lastSeen: now, load: 0.1, successRate: 0.95, avgLatency: 100 });
    registry.upsertPeer({ id: 'p2', capabilities: ['b'], status: 'online', lastSeen: now, load: 0.2, successRate: 0.9, avgLatency: 200 });
    expect(registry.getAllPeers().length).toBe(2);
    const h = hc.registryHealth(registry);
    expect(h.score).toBeGreaterThan(0.5);
  });

  test('offline peers reduce score', () => {
    registry.upsertPeer({ id: 'p1', capabilities: ['a'], status: 'offline', lastSeen: Date.now() - 600000, load: 0, successRate: 0.5, avgLatency: 5000 });
    const h = hc.registryHealth(registry);
    expect(h.score).toBeLessThan(0.5);
  });

  test('stale lastSeen reduces freshness', () => {
    registry.upsertPeer({ id: 'p1', capabilities: ['a'], status: 'online', lastSeen: Date.now() - 400000, load: 0, successRate: 1, avgLatency: 0 });
    const h = hc.registryHealth(registry);
    expect(h.details.avgFreshness).toBeLessThan(1);
  });

  // --- Router health ---

  test('no tasks → score 1.0', () => {
    const h = hc.routerHealth(router);
    expect(h.score).toBe(1.0);
  });

  test('all completed tasks → high score', () => {
    router.createTask('t1', 'type', ['cap']);
    router.createTask('t2', 'type', ['cap']);
    router.submitBid({ taskId: 't1', nodeId: 'p1', estimatedTime: 1000, confidence: 0.9, load: 0.1, timestamp: Date.now() });
    router.submitBid({ taskId: 't2', nodeId: 'p1', estimatedTime: 1000, confidence: 0.9, load: 0.1, timestamp: Date.now() });
    router.assignTask('t1');
    router.assignTask('t2');
    router.completeTask('t1', 'ok', 100);
    router.completeTask('t2', 'ok', 100);
    const h = hc.routerHealth(router);
    expect(h.score).toBeGreaterThan(0.8);
  });

  test('failed tasks reduce score', () => {
    router.createTask('t1', 'type', ['cap']);
    router.createTask('t2', 'type', ['cap']);
    router.submitBid({ taskId: 't1', nodeId: 'p1', estimatedTime: 1000, confidence: 0.9, load: 0.1, timestamp: Date.now() });
    router.submitBid({ taskId: 't2', nodeId: 'p1', estimatedTime: 1000, confidence: 0.9, load: 0.1, timestamp: Date.now() });
    router.assignTask('t1');
    router.assignTask('t2');
    router.failTask('t1', 'err', 100);
    router.failTask('t2', 'err', 100);
    const h = hc.routerHealth(router);
    expect(h.score).toBeLessThan(0.5);
  });

  test('pending tasks score lower than completed', () => {
    router.createTask('t1', 'type', ['cap']);
    const h = hc.routerHealth(router);
    // 1 pending, 0 completed → completionRatio=0, activeRatio=1, successRatio=0
    // score = 0*0.5 + 1*0.3 + 0*0.2 = 0.3
    expect(h.score).toBe(0.3);
  });

  // --- Bus health ---

  test('no messages → score 1.0', () => {
    const h = hc.busHealth(bus);
    expect(h.score).toBe(1.0);
  });

  test('all accepted → score 1.0', () => {
    bus.addRoute({ messageType: 'test', handlerName: 'h1', priority: 1 });
    bus.route({ id: '1', from: 'a', type: 'test', payload: {}, timestamp: Date.now(), ttl: 10 });
    const h = hc.busHealth(bus);
    expect(h.score).toBe(1.0);
  });

  test('rejected messages reduce score', () => {
    bus.addValidationRule({ name: 'test', validate: () => 'blocked' });
    bus.route({ id: '1', from: 'a', type: 'test', payload: {}, timestamp: Date.now(), ttl: 10 });
    bus.route({ id: '2', from: 'a', type: 'test', payload: {}, timestamp: Date.now(), ttl: 10 });
    const h = hc.busHealth(bus);
    expect(h.score).toBe(0.0);
  });

  // --- Full report ---

  test('check with all layers returns complete report', () => {
    const report = hc.check({ circuitBreaker: cb, registry, router, bus });
    // CB=1.0, registry=0.5 (no peers), router=1.0, bus=1.0
    // weighted: 1.0*0.25 + 0.5*0.3 + 1.0*0.25 + 1.0*0.2 = 0.25+0.15+0.25+0.2 = 0.85
    expect(report.overallScore).toBeCloseTo(0.85);
    expect(report.status).toBe('healthy'); // > 0.7
    expect(report.layers).toHaveLength(4);
    expect(report.timestamp).toBeGreaterThan(0);
  });

  test('check with no layers returns healthy', () => {
    const report = hc.check({});
    expect(report.overallScore).toBe(1.0);
    expect(report.status).toBe('healthy');
    expect(report.layers).toHaveLength(0);
  });

  test('check with single layer uses weight correctly', () => {
    // Single layer: router with failed tasks
    router.createTask('t1', 'type', ['cap']);
    router.failTask('t1', 'err', 100);
    const report = hc.check({ router });
    expect(report.overallScore).toBeLessThan(0.5);
  });

  // --- Status classification ---

  test('healthy status for high scores', () => {
    expect(hc.check({}).status).toBe('healthy');
  });

  test('degraded status below threshold', () => {
    // Force a bad circuit breaker: 1 open / 1 closed = score 0.5
    for (let i = 0; i < 3; i++) cb.recordFailure('p1'); // open
    cb.recordSuccess('p2'); // closed
    const report = hc.check({ circuitBreaker: cb });
    // score = 0.5 → degraded (>= 0.4 but < 0.7)
    expect(report.status).toBe('degraded');
  });

  test('custom thresholds', () => {
    hc = new MeshHealthCheck({ degraded: 0.5, unhealthy: 0.3, critical: 0.1 });
    // Default healthy systems should still be healthy
    expect(hc.check({}).status).toBe('healthy');
  });

  // --- Recommendations ---

  test('healthy systems get nominal recommendation', () => {
    const report = hc.check({});
    expect(report.recommendations[0]).toContain('nominal');
  });

  test('degraded layers generate recommendations', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    const report = hc.check({ circuitBreaker: cb });
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0]).toContain('circuit-breaker');
  });

  test('critical layers generate critical recommendations', () => {
    // Make all circuits open → score 0.0
    for (let i = 0; i < 3; i++) cb.recordFailure('p1');
    for (let i = 0; i < 3; i++) cb.recordFailure('p2');
    for (let i = 0; i < 3; i++) cb.recordFailure('p3');
    // Also add bad peers
    registry.upsertPeer({ id: 'p1', capabilities: ['a'], status: 'offline', lastSeen: 0, load: 1, successRate: 0, avgLatency: 5000 });
    const report = hc.check({ circuitBreaker: cb, registry });
    expect(report.status).toBe('critical');
    expect(report.recommendations.some(r => r.includes('circuit-breaker'))).toBe(true);
  });

  // --- Default thresholds ---

  test('default thresholds are correct', () => {
    expect(DEFAULT_THRESHOLDS.degraded).toBe(0.7);
    expect(DEFAULT_THRESHOLDS.unhealthy).toBe(0.4);
    expect(DEFAULT_THRESHOLDS.critical).toBe(0.2);
    expect(DEFAULT_THRESHOLDS.weights.circuitBreaker).toBe(0.25);
    expect(DEFAULT_THRESHOLDS.weights.registry).toBe(0.3);
    expect(DEFAULT_THRESHOLDS.weights.router).toBe(0.25);
    expect(DEFAULT_THRESHOLDS.weights.bus).toBe(0.2);
  });

  // --- Weighted aggregation ---

  test('weights sum to 1.0', () => {
    const w = DEFAULT_THRESHOLDS.weights;
    expect(w.circuitBreaker + w.registry + w.router + w.bus).toBeCloseTo(1.0);
  });

  test('registry has highest weight (0.3)', () => {
    expect(DEFAULT_THRESHOLDS.weights.registry).toBeGreaterThan(DEFAULT_THRESHOLDS.weights.circuitBreaker);
    expect(DEFAULT_THRESHOLDS.weights.registry).toBeGreaterThan(DEFAULT_THRESHOLDS.weights.router);
    expect(DEFAULT_THRESHOLDS.weights.registry).toBeGreaterThan(DEFAULT_THRESHOLDS.weights.bus);
  });
});
