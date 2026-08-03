/**
 * MessageBus — Lightweight message validation and routing layer.
 * 
 * Validates message format, TTL expiration, and provides a routing
 * table for message type → handler mapping. Pure logic, no networking.
 */

export interface BusMessage {
  id: string;
  from: string;
  to?: string;
  type: string;
  payload: any;
  timestamp: number;
  ttl: number;       // seconds
  signature?: string;
}

export interface ValidationRule {
  name: string;
  validate: (msg: BusMessage) => string | null;  // null = pass, string = error
}

export interface RoutingEntry {
  messageType: string;
  handlerName: string;
  priority: number;
}

export class MessageBus {
  private handlers: Map<string, Map<string, number>> = new Map();  // type → Map<handlerName, priority>
  private validationRules: ValidationRule[] = [];
  private messageCount: number = 0;
  private rejectedCount: number = 0;

  /**
   * Register a handler for a message type
   */
  addRoute(entry: RoutingEntry): void {
    if (!this.handlers.has(entry.messageType)) {
      this.handlers.set(entry.messageType, new Map());
    }
    this.handlers.get(entry.messageType)!.set(entry.handlerName, entry.priority);
  }

  /**
   * Remove a handler
   */
  removeRoute(messageType: string, handlerName: string): boolean {
    return this.handlers.get(messageType)?.delete(handlerName) ?? false;
  }

  /**
   * Get handlers for a message type, sorted by priority (highest first)
   */
  getHandlers(messageType: string): { name: string; priority: number }[] {
    const map = this.handlers.get(messageType);
    if (!map) return [];
    return Array.from(map.entries())
      .map(([name, priority]) => ({ name, priority }))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all registered message types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a message type has any handlers
   */
  hasHandler(messageType: string): boolean {
    return (this.handlers.get(messageType)?.size ?? 0) > 0;
  }

  /**
   * Add a validation rule
   */
  addValidationRule(rule: ValidationRule): void {
    this.validationRules.push(rule);
  }

  /**
   * Remove validation rule by name
   */
  removeValidationRule(name: string): boolean {
    const idx = this.validationRules.findIndex(r => r.name === name);
    if (idx === -1) return false;
    this.validationRules.splice(idx, 1);
    return true;
  }

  /**
   * Validate a message against all rules
   */
  validate(msg: BusMessage): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const rule of this.validationRules) {
      const err = rule.validate(msg);
      if (err) errors.push(`${rule.name}: ${err}`);
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if message TTL has expired
   */
  isExpired(msg: BusMessage): boolean {
    const age = (Date.now() - msg.timestamp) / 1000;
    return age > msg.ttl;
  }

  /**
   * Route a message: validate + find handlers
   */
  route(msg: BusMessage): {
    handled: boolean;
    handlers: { name: string; priority: number }[];
    validation: { valid: boolean; errors: string[] };
    expired: boolean;
  } {
    this.messageCount++;
    const validation = this.validate(msg);
    const expired = this.isExpired(msg);
    const handlers = this.getHandlers(msg.type);

    if (!validation.valid || expired) {
      this.rejectedCount++;
      return { handled: false, handlers: [], validation, expired };
    }

    return { handled: handlers.length > 0, handlers, validation, expired };
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      messageCount: this.messageCount,
      rejectedCount: this.rejectedCount,
      registeredTypes: this.handlers.size,
      validationRules: this.validationRules.length
    };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.messageCount = 0;
    this.rejectedCount = 0;
  }

  /**
   * Clear all routes and rules
   */
  clear(): void {
    this.handlers.clear();
    this.validationRules = [];
    this.resetStats();
  }
}

export default MessageBus;
