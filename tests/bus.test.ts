/**
 * Tests for MessageBus — message validation and routing
 */

import { MessageBus, BusMessage, RoutingEntry, ValidationRule } from '../src/core/bus';

const makeMsg = (overrides: Partial<BusMessage> & { id: string }): BusMessage => ({
  from: 'sender',
  type: 'task_request',
  payload: {},
  timestamp: Date.now(),
  ttl: 10,
  ...overrides,
});

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('addRoute / getHandlers', () => {
    test('registers a handler for a message type', () => {
      bus.addRoute({ messageType: 'task_request', handlerName: 'h1', priority: 1 });
      const handlers = bus.getHandlers('task_request');
      expect(handlers).toHaveLength(1);
      expect(handlers[0].name).toBe('h1');
    });

    test('sorts handlers by priority (highest first)', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'low', priority: 1 });
      bus.addRoute({ messageType: 'x', handlerName: 'high', priority: 10 });
      bus.addRoute({ messageType: 'x', handlerName: 'mid', priority: 5 });
      const handlers = bus.getHandlers('x');
      expect(handlers.map(h => h.name)).toEqual(['high', 'mid', 'low']);
    });

    test('returns empty for unregistered type', () => {
      expect(bus.getHandlers('nope')).toEqual([]);
    });

    test('allows multiple handlers for same type', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'a', priority: 1 });
      bus.addRoute({ messageType: 'x', handlerName: 'b', priority: 2 });
      expect(bus.getHandlers('x')).toHaveLength(2);
    });
  });

  describe('removeRoute', () => {
    test('removes existing handler', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'h1', priority: 1 });
      expect(bus.removeRoute('x', 'h1')).toBe(true);
      expect(bus.getHandlers('x')).toEqual([]);
    });

    test('returns false for non-existent', () => {
      expect(bus.removeRoute('x', 'nope')).toBe(false);
    });
  });

  describe('getRegisteredTypes / hasHandler', () => {
    test('lists registered types', () => {
      bus.addRoute({ messageType: 'a', handlerName: 'h1', priority: 1 });
      bus.addRoute({ messageType: 'b', handlerName: 'h2', priority: 1 });
      expect(bus.getRegisteredTypes()).toEqual(['a', 'b']);
    });

    test('hasHandler returns true for registered type', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'h1', priority: 1 });
      expect(bus.hasHandler('x')).toBe(true);
      expect(bus.hasHandler('nope')).toBe(false);
    });
  });

  describe('addValidationRule / removeValidationRule', () => {
    test('adds and removes rules', () => {
      const rule: ValidationRule = { name: 'r1', validate: () => null };
      bus.addValidationRule(rule);
      expect(bus.getStats().validationRules).toBe(1);
      expect(bus.removeValidationRule('r1')).toBe(true);
      expect(bus.getStats().validationRules).toBe(0);
    });

    test('remove returns false for missing rule', () => {
      expect(bus.removeValidationRule('nope')).toBe(false);
    });
  });

  describe('validate', () => {
    test('returns valid for no rules', () => {
      const msg = makeMsg({ id: '1' });
      expect(bus.validate(msg).valid).toBe(true);
      expect(bus.validate(msg).errors).toEqual([]);
    });

    test('catches validation failures', () => {
      bus.addValidationRule({
        name: 'non-empty-payload',
        validate: (msg) => Object.keys(msg.payload).length === 0 ? 'payload must not be empty' : null
      });
      const empty = makeMsg({ id: '1', payload: {} });
      const filled = makeMsg({ id: '2', payload: { data: 'x' } });
      expect(bus.validate(empty).valid).toBe(false);
      expect(bus.validate(empty).errors).toHaveLength(1);
      expect(bus.validate(filled).valid).toBe(true);
    });

    test('collects all rule violations', () => {
      bus.addValidationRule({ name: 'r1', validate: () => 'error1' });
      bus.addValidationRule({ name: 'r2', validate: () => 'error2' });
      const result = bus.validate(makeMsg({ id: '1' }));
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('r1');
      expect(result.errors[1]).toContain('r2');
    });

    test('type-specific validation rule', () => {
      bus.addValidationRule({
        name: 'heartbeat-requires-ttl',
        validate: (msg) => msg.type === 'heartbeat' && msg.ttl > 5 ? 'heartbeat TTL too high' : null
      });
      const good = makeMsg({ id: '1', type: 'heartbeat', ttl: 3 });
      const bad = makeMsg({ id: '2', type: 'heartbeat', ttl: 10 });
      expect(bus.validate(good).valid).toBe(true);
      expect(bus.validate(bad).valid).toBe(false);
    });
  });

  describe('isExpired', () => {
    test('not expired for fresh message', () => {
      expect(bus.isExpired(makeMsg({ id: '1', timestamp: Date.now(), ttl: 10 }))).toBe(false);
    });

    test('expired for old message', () => {
      expect(bus.isExpired(makeMsg({ id: '1', timestamp: Date.now() - 15000, ttl: 10 }))).toBe(true);
    });

    test('boundary: exactly at TTL is not expired', () => {
      expect(bus.isExpired(makeMsg({ id: '1', timestamp: Date.now() - 10000, ttl: 10 }))).toBe(false);
    });

    test('handles zero TTL', () => {
      expect(bus.isExpired(makeMsg({ id: '1', timestamp: Date.now(), ttl: 0 }))).toBe(false);
      expect(bus.isExpired(makeMsg({ id: '1', timestamp: Date.now() - 1, ttl: 0 }))).toBe(true);
    });
  });

  describe('route', () => {
    test('routes valid message to handlers', () => {
      bus.addRoute({ messageType: 'task_request', handlerName: 'h1', priority: 1 });
      const result = bus.route(makeMsg({ id: '1' }));
      expect(result.handled).toBe(true);
      expect(result.handlers).toHaveLength(1);
      expect(result.validation.valid).toBe(true);
      expect(result.expired).toBe(false);
    });

    test('rejects message that fails validation', () => {
      bus.addValidationRule({ name: 'r1', validate: () => 'fail' });
      bus.addRoute({ messageType: 'task_request', handlerName: 'h1', priority: 1 });
      const result = bus.route(makeMsg({ id: '1' }));
      expect(result.handled).toBe(false);
      expect(result.handlers).toEqual([]);
      expect(result.validation.valid).toBe(false);
    });

    test('rejects expired message', () => {
      bus.addRoute({ messageType: 'task_request', handlerName: 'h1', priority: 1 });
      const result = bus.route(makeMsg({ id: '1', timestamp: Date.now() - 20000, ttl: 10 }));
      expect(result.handled).toBe(false);
      expect(result.expired).toBe(true);
    });

    test('handled=false when no handlers registered', () => {
      const result = bus.route(makeMsg({ id: '1', type: 'unknown' }));
      expect(result.handled).toBe(false);
      expect(result.handlers).toEqual([]);
    });

    test('increments message and rejected counters', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'h1', priority: 1 });
      bus.route(makeMsg({ id: '1', type: 'x' }));
      bus.addValidationRule({ name: 'r', validate: () => 'fail' });
      bus.route(makeMsg({ id: '2', type: 'x' }));
      expect(bus.getStats().messageCount).toBe(2);
      expect(bus.getStats().rejectedCount).toBe(1);
    });
  });

  describe('getStats', () => {
    test('returns initial stats', () => {
      expect(bus.getStats()).toEqual({
        messageCount: 0,
        rejectedCount: 0,
        registeredTypes: 0,
        validationRules: 0
      });
    });
  });

  describe('resetStats', () => {
    test('resets counters', () => {
      bus.route(makeMsg({ id: '1' }));
      bus.resetStats();
      expect(bus.getStats().messageCount).toBe(0);
    });
  });

  describe('clear', () => {
    test('removes everything', () => {
      bus.addRoute({ messageType: 'x', handlerName: 'h1', priority: 1 });
      bus.addValidationRule({ name: 'r1', validate: () => null });
      bus.route(makeMsg({ id: '1' }));
      bus.clear();
      expect(bus.getRegisteredTypes()).toEqual([]);
      expect(bus.getStats().validationRules).toBe(0);
      expect(bus.getStats().messageCount).toBe(0);
    });
  });
});
