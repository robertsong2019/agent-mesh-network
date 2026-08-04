/**
 * MeshHealthCheck — Aggregate health scoring across mesh network layers.
 * 
 * Combines circuit breaker, registry, router, and bus statistics
 * into a single health score (0..1). Pure logic, no networking.
 */

import { CircuitBreaker } from './circuit-breaker';
import { MeshRegistry } from './registry';
import { TaskRouter } from './router';
import { MessageBus } from './bus';

export interface LayerHealth {
  name: string;
  score: number;         // 0..1
  details: Record<string, number | string>;
}

export interface MeshHealthReport {
  overallScore: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  layers: LayerHealth[];
  timestamp: number;
  recommendations: string[];
}

export interface HealthThresholds {
  degraded: number;      // below this = degraded (default: 0.7)
  unhealthy: number;     // below this = unhealthy (default: 0.4)
  critical: number;      // below this = critical (default: 0.2)
  weights: {             // layer weights for overall score
    circuitBreaker: number;
    registry: number;
    router: number;
    bus: number;
  };
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  degraded: 0.7,
  unhealthy: 0.4,
  critical: 0.2,
  weights: {
    circuitBreaker: 0.25,
    registry: 0.3,
    router: 0.25,
    bus: 0.2
  }
};

export class MeshHealthCheck {
  private thresholds: HealthThresholds;

  constructor(thresholds?: Partial<HealthThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Compute circuit breaker health
   * Score: ratio of closed/(total) circuits. No circuits = 1.0.
   */
  circuitBreakerHealth(cb: CircuitBreaker): LayerHealth {
    const summary = cb.getSummary();
    if (summary.total === 0) {
      return { name: 'circuit-breaker', score: 1.0, details: { total: 0 } };
    }
    const score = summary.closed / summary.total;
    return {
      name: 'circuit-breaker',
      score,
      details: {
        total: summary.total,
        closed: summary.closed,
        open: summary.open,
        halfOpen: summary.halfOpen
      }
    };
  }

  /**
   * Compute registry health
   * Factors: online ratio (60%), avg success rate (30%), avg freshness (10%)
   */
  registryHealth(registry: MeshRegistry): LayerHealth {
    const peers = registry.getAllPeers();
    if (peers.length === 0) {
      return { name: 'registry', score: 0.5, details: { total: 0, note: 'no-peers' } };
    }

    const onlineRatio = peers.filter(p => p.status === 'online').length / peers.length;
    const avgSuccessRate = peers.reduce((s, p) => s + p.successRate, 0) / peers.length;

    const now = Date.now();
    const avgFreshness = peers.reduce((s, p) => {
      const age = now - p.lastSeen;
      return s + Math.max(0, 1 - age / 300000); // 5min window
    }, 0) / peers.length;

    const score = onlineRatio * 0.6 + avgSuccessRate * 0.3 + avgFreshness * 0.1;

    return {
      name: 'registry',
      score: Math.min(1, Math.max(0, score)),
      details: {
        total: peers.length,
        online: peers.filter(p => p.status === 'online').length,
        onlineRatio: Math.round(onlineRatio * 100) / 100,
        avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
        avgFreshness: Math.round(avgFreshness * 100) / 100
      }
    };
  }

  /**
   * Compute router health
   * Factors: completion ratio (50%), non-expired tasks (30%), no-timeout ratio (20%)
   */
  routerHealth(router: TaskRouter): LayerHealth {
    const tasks = router.getAllTasks();
    if (tasks.length === 0) {
      return { name: 'router', score: 1.0, details: { total: 0 } };
    }

    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const expired = router.getExpiredTasks().length;
    const total = tasks.length;

    const completionRatio = completed / total;
    const activeRatio = (total - expired) / total;
    const successRatio = completed / Math.max(1, completed + failed);

    const score = completionRatio * 0.5 + activeRatio * 0.3 + successRatio * 0.2;

    return {
      name: 'router',
      score: Math.min(1, Math.max(0, score)),
      details: {
        total,
        completed,
        failed,
        expired,
        completionRatio: Math.round(completionRatio * 100) / 100,
        successRatio: Math.round(successRatio * 100) / 100
      }
    };
  }

  /**
   * Compute bus health
   * Factors: acceptance rate (60%), no validation errors (40%)
   */
  busHealth(bus: MessageBus): LayerHealth {
    const stats = bus.getStats();
    if (stats.messageCount === 0) {
      return { name: 'bus', score: 1.0, details: { total: 0 } };
    }

    const acceptanceRate = 1 - stats.rejectedCount / stats.messageCount;
    const score = acceptanceRate;

    return {
      name: 'bus',
      score: Math.min(1, Math.max(0, score)),
      details: {
        messageCount: stats.messageCount,
        rejectedCount: stats.rejectedCount,
        acceptanceRate: Math.round(acceptanceRate * 100) / 100,
        registeredTypes: stats.registeredTypes,
        validationRules: stats.validationRules
      }
    };
  }

  /**
   * Generate full mesh health report
   */
  check(opts: {
    circuitBreaker?: CircuitBreaker;
    registry?: MeshRegistry;
    router?: TaskRouter;
    bus?: MessageBus;
  }): MeshHealthReport {
    const layers: LayerHealth[] = [];

    if (opts.circuitBreaker) {
      layers.push(this.circuitBreakerHealth(opts.circuitBreaker));
    }
    if (opts.registry) {
      layers.push(this.registryHealth(opts.registry));
    }
    if (opts.router) {
      layers.push(this.routerHealth(opts.router));
    }
    if (opts.bus) {
      layers.push(this.busHealth(opts.bus));
    }

    // Weighted average
    const w = this.thresholds.weights;
    let overallScore = 0;
    if (layers.length === 0) {
      overallScore = 1.0;
    } else {
      const weights = layers.map(l => {
        if (l.name === 'circuit-breaker') return w.circuitBreaker;
        if (l.name === 'registry') return w.registry;
        if (l.name === 'router') return w.router;
        return w.bus;
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      overallScore = layers.reduce((s, l, i) => s + l.score * weights[i], 0) / totalWeight;
    }

    const recommendations = this.generateRecommendations(layers, overallScore);

    return {
      overallScore,
      status: this.classifyStatus(overallScore),
      layers,
      timestamp: Date.now(),
      recommendations
    };
  }

  private classifyStatus(score: number): MeshHealthReport['status'] {
    if (score >= this.thresholds.degraded) return 'healthy';
    if (score >= this.thresholds.unhealthy) return 'degraded';
    if (score >= this.thresholds.critical) return 'unhealthy';
    return 'critical';
  }

  private generateRecommendations(layers: LayerHealth[], overallScore: number): string[] {
    const recs: string[] = [];
    if (overallScore >= 0.9) {
      recs.push('All systems nominal.');
      return recs;
    }

    for (const layer of layers) {
      if (layer.score < 0.3) {
        recs.push(`[${layer.name}] Critical — immediate investigation needed.`);
      } else if (layer.score < 0.6) {
        recs.push(`[${layer.name}] Below acceptable threshold — consider remediation.`);
      }
    }

    if (recs.length === 0 && overallScore < 0.9) {
      recs.push('Minor degradation detected — monitoring recommended.');
    }

    return recs;
  }
}

export default MeshHealthCheck;
