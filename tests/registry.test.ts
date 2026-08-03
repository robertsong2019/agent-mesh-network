/**
 * Tests for MeshRegistry — peer capability registry
 */

import { MeshRegistry, PeerEntry } from '../src/core/registry';

const makePeer = (overrides: Partial<PeerEntry> & { id: string }): PeerEntry => ({
  capabilities: [],
  status: 'online',
  lastSeen: Date.now(),
  load: 0,
  successRate: 1,
  avgLatency: 0,
  ...overrides,
});

describe('MeshRegistry', () => {
  let reg: MeshRegistry;

  beforeEach(() => {
    reg = new MeshRegistry();
  });

  describe('upsertPeer', () => {
    test('adds a new peer', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'] }));
      expect(reg.size).toBe(1);
      expect(reg.getPeer('p1')!.capabilities).toEqual(['a']);
    });

    test('updates existing peer (merge)', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'], load: 0.2 }));
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a', 'b'], load: 0.8 }));
      expect(reg.size).toBe(1);
      const p = reg.getPeer('p1')!;
      expect(p.capabilities).toEqual(['a', 'b']);
      expect(p.load).toBe(0.8);
    });
  });

  describe('removePeer', () => {
    test('removes existing peer', () => {
      reg.upsertPeer(makePeer({ id: 'p1' }));
      expect(reg.removePeer('p1')).toBe(true);
      expect(reg.size).toBe(0);
    });

    test('returns false for non-existent peer', () => {
      expect(reg.removePeer('nope')).toBe(false);
    });
  });

  describe('getPeer / hasPeer', () => {
    test('returns undefined for missing peer', () => {
      expect(reg.getPeer('nope')).toBeUndefined();
    });

    test('hasPeer returns false for missing', () => {
      expect(reg.hasPeer('nope')).toBe(false);
    });

    test('hasPeer returns true after upsert', () => {
      reg.upsertPeer(makePeer({ id: 'p1' }));
      expect(reg.hasPeer('p1')).toBe(true);
    });
  });

  describe('getAllPeers / size', () => {
    test('returns empty array initially', () => {
      expect(reg.getAllPeers()).toEqual([]);
      expect(reg.size).toBe(0);
    });

    test('returns all registered peers', () => {
      reg.upsertPeer(makePeer({ id: 'p1' }));
      reg.upsertPeer(makePeer({ id: 'p2' }));
      reg.upsertPeer(makePeer({ id: 'p3' }));
      expect(reg.getAllPeers()).toHaveLength(3);
    });
  });

  describe('getPeersByStatus', () => {
    test('filters by online status', () => {
      reg.upsertPeer(makePeer({ id: 'p1', status: 'online' }));
      reg.upsertPeer(makePeer({ id: 'p2', status: 'busy' }));
      reg.upsertPeer(makePeer({ id: 'p3', status: 'offline' }));
      reg.upsertPeer(makePeer({ id: 'p4', status: 'online' }));
      expect(reg.getPeersByStatus('online')).toHaveLength(2);
      expect(reg.getPeersByStatus('busy')).toHaveLength(1);
      expect(reg.getPeersByStatus('offline')).toHaveLength(1);
    });

    test('returns empty for no matches', () => {
      expect(reg.getPeersByStatus('online')).toEqual([]);
    });
  });

  describe('setPeerStatus', () => {
    test('updates status of existing peer', () => {
      reg.upsertPeer(makePeer({ id: 'p1', status: 'online' }));
      expect(reg.setPeerStatus('p1', 'busy')).toBe(true);
      expect(reg.getPeer('p1')!.status).toBe('busy');
    });

    test('returns false for non-existent peer', () => {
      expect(reg.setPeerStatus('nope', 'online')).toBe(false);
    });

    test('updates lastSeen on status change', () => {
      const ts = Date.now() - 10000;
      reg.upsertPeer(makePeer({ id: 'p1', lastSeen: ts }));
      reg.setPeerStatus('p1', 'busy');
      expect(reg.getPeer('p1')!.lastSeen).toBeGreaterThanOrEqual(ts);
    });
  });

  describe('touchPeer', () => {
    test('updates lastSeen for existing peer', () => {
      reg.upsertPeer(makePeer({ id: 'p1', lastSeen: 1000 }));
      reg.touchPeer('p1');
      expect(reg.getPeer('p1')!.lastSeen).toBeGreaterThan(1000);
    });

    test('returns false for non-existent peer', () => {
      expect(reg.touchPeer('nope')).toBe(false);
    });
  });

  describe('findPeersWithCapabilities (AND)', () => {
    test('finds peers with all required capabilities', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a', 'b', 'c'] }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['a', 'b'] }));
      reg.upsertPeer(makePeer({ id: 'p3', capabilities: ['a'] }));
      expect(reg.findPeersWithCapabilities(['a', 'b']).map(p => p.id)).toEqual(['p1', 'p2']);
    });

    test('returns empty for impossible requirements', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'] }));
      expect(reg.findPeersWithCapabilities(['z'])).toEqual([]);
    });

    test('matches all peers when requirements empty', () => {
      reg.upsertPeer(makePeer({ id: 'p1' }));
      reg.upsertPeer(makePeer({ id: 'p2' }));
      expect(reg.findPeersWithCapabilities([])).toHaveLength(2);
    });
  });

  describe('findPeersWithAnyCapability (OR)', () => {
    test('finds peers with any matching capability', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'] }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['b'] }));
      reg.upsertPeer(makePeer({ id: 'p3', capabilities: ['c'] }));
      expect(reg.findPeersWithAnyCapability(['a', 'b']).map(p => p.id)).toEqual(['p1', 'p2']);
    });

    test('returns empty when no capabilities match', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['x'] }));
      expect(reg.findPeersWithAnyCapability(['a', 'b'])).toEqual([]);
    });
  });

  describe('findAvailablePeers', () => {
    test('finds online peers with required capabilities', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a', 'b'], status: 'online' }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['a', 'b'], status: 'busy' }));
      reg.upsertPeer(makePeer({ id: 'p3', capabilities: ['a'], status: 'online' }));
      expect(reg.findAvailablePeers(['a', 'b']).map(p => p.id)).toEqual(['p1']);
    });
  });

  describe('scorePeers', () => {
    test('ranks exact match above partial match', () => {
      reg.upsertPeer(makePeer({ id: 'p-exact', capabilities: ['a', 'b'], status: 'online', load: 0, successRate: 1, avgLatency: 0 }));
      reg.upsertPeer(makePeer({ id: 'p-partial', capabilities: ['a'], status: 'online', load: 0, successRate: 1, avgLatency: 0 }));
      const scores = reg.scorePeers(['a', 'b']);
      expect(scores[0].peerId).toBe('p-exact');
      expect(scores[0].score).toBeGreaterThan(scores[1].score);
    });

    test('penalizes offline peers', () => {
      reg.upsertPeer(makePeer({ id: 'p-offline', capabilities: ['a'], status: 'offline' }));
      reg.upsertPeer(makePeer({ id: 'p-online', capabilities: ['a'], status: 'online' }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-online');
    });

    test('penalizes high load', () => {
      reg.upsertPeer(makePeer({ id: 'p-busy', capabilities: ['a'], status: 'online', load: 0.9 }));
      reg.upsertPeer(makePeer({ id: 'p-free', capabilities: ['a'], status: 'online', load: 0.1 }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-free');
    });

    test('prefers high success rate', () => {
      reg.upsertPeer(makePeer({ id: 'p-good', capabilities: ['a'], status: 'online', successRate: 0.95 }));
      reg.upsertPeer(makePeer({ id: 'p-bad', capabilities: ['a'], status: 'online', successRate: 0.3 }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-good');
    });

    test('prefers low latency', () => {
      reg.upsertPeer(makePeer({ id: 'p-fast', capabilities: ['a'], status: 'online', avgLatency: 50 }));
      reg.upsertPeer(makePeer({ id: 'p-slow', capabilities: ['a'], status: 'online', avgLatency: 4000 }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-fast');
    });

    test('includes reasons for scoring', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a', 'b'], status: 'online', load: 0.1, successRate: 0.95 }));
      const scores = reg.scorePeers(['a', 'b']);
      expect(scores[0].reasons).toContain('exact-capability-match');
      expect(scores[0].reasons).toContain('online');
      expect(scores[0].reasons).toContain('low-load');
      expect(scores[0].reasons).toContain('high-success');
    });

    test('returns partial-match reason for incomplete capabilities', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'], status: 'online' }));
      const scores = reg.scorePeers(['a', 'b', 'c']);
      expect(scores[0].reasons[0]).toContain('partial-match');
    });

    test('returns empty for no peers', () => {
      expect(reg.scorePeers(['a'])).toEqual([]);
    });

    test('options can disable factors', () => {
      reg.upsertPeer(makePeer({ id: 'p-heavy', capabilities: ['a'], status: 'online', load: 0.95 }));
      reg.upsertPeer(makePeer({ id: 'p-light', capabilities: ['a'], status: 'online', load: 0.05 }));
      // When load is not preferred, scores should be equal
      const scores = reg.scorePeers(['a'], { preferLowLoad: false });
      expect(scores[0].score).toBeCloseTo(scores[1].score);
    });

    test('bonus for extra capabilities beyond requirements', () => {
      reg.upsertPeer(makePeer({ id: 'p-extra', capabilities: ['a', 'b', 'c', 'd'], status: 'online' }));
      reg.upsertPeer(makePeer({ id: 'p-min', capabilities: ['a', 'b'], status: 'online' }));
      const scores = reg.scorePeers(['a', 'b']);
      expect(scores[0].peerId).toBe('p-extra');
    });
  });

  describe('getBestPeer', () => {
    test('returns highest scored peer', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a', 'b'], status: 'online', load: 0.1 }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['a'], status: 'online', load: 0.5 }));
      const best = reg.getBestPeer(['a', 'b']);
      expect(best!.peerId).toBe('p1');
    });

    test('returns null when no peers', () => {
      expect(reg.getBestPeer(['a'])).toBeNull();
    });
  });

  describe('recordResult', () => {
    test('updates success rate on success', () => {
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.5 }));
      reg.recordResult('p1', true, 100);
      const p = reg.getPeer('p1')!;
      expect(p.successRate).toBeGreaterThan(0.5);
    });

    test('decreases success rate on failure', () => {
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.8 }));
      reg.recordResult('p1', false, 100);
      const p = reg.getPeer('p1')!;
      expect(p.successRate).toBeLessThan(0.8);
    });

    test('updates avg latency', () => {
      reg.upsertPeer(makePeer({ id: 'p1', avgLatency: 100 }));
      reg.recordResult('p1', true, 300);
      const p = reg.getPeer('p1')!;
      expect(p.avgLatency).toBeGreaterThan(100);
    });

    test('ignores non-existent peer', () => {
      expect(() => reg.recordResult('nope', true, 100)).not.toThrow();
    });

    test('converges success rate with repeated results', () => {
      reg.upsertPeer(makePeer({ id: 'p1', successRate: 0.5 }));
      for (let i = 0; i < 100; i++) {
        reg.recordResult('p1', true, 100);
      }
      expect(reg.getPeer('p1')!.successRate).toBeGreaterThan(0.95);
    });
  });

  describe('getAllCapabilities', () => {
    test('returns sorted unique capabilities', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['b', 'a'] }));
      reg.upsertPeer(makePeer({ id: 'p2', capabilities: ['c', 'a'] }));
      expect(reg.getAllCapabilities()).toEqual(['a', 'b', 'c']);
    });

    test('returns empty for no peers', () => {
      expect(reg.getAllCapabilities()).toEqual([]);
    });
  });

  describe('getStalePeers', () => {
    test('finds peers not seen recently', () => {
      const now = Date.now();
      reg.upsertPeer(makePeer({ id: 'p1', lastSeen: now }));
      reg.upsertPeer(makePeer({ id: 'p2', lastSeen: now - 120000 }));
      reg.upsertPeer(makePeer({ id: 'p3', lastSeen: now - 60000 }));
      const stale = reg.getStalePeers(60000);
      expect(stale.map(p => p.id)).toEqual(['p2']);
    });
  });

  describe('clear', () => {
    test('removes all peers', () => {
      reg.upsertPeer(makePeer({ id: 'p1' }));
      reg.upsertPeer(makePeer({ id: 'p2' }));
      reg.clear();
      expect(reg.size).toBe(0);
      expect(reg.getAllPeers()).toEqual([]);
    });
  });

  describe('edge cases', () => {
    test('handles peer with empty capabilities array', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: [] }));
      expect(reg.findPeersWithCapabilities([]).map(p => p.id)).toEqual(['p1']);
      expect(reg.findPeersWithCapabilities(['a'])).toEqual([]);
    });

    test('handles duplicate peer IDs (last write wins)', () => {
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['a'] }));
      reg.upsertPeer(makePeer({ id: 'p1', capabilities: ['b'] }));
      expect(reg.getPeer('p1')!.capabilities).toEqual(['b']);
      expect(reg.size).toBe(1);
    });

    test('handles extreme load values (0 and 1)', () => {
      reg.upsertPeer(makePeer({ id: 'p-idle', capabilities: ['a'], status: 'online', load: 0 }));
      reg.upsertPeer(makePeer({ id: 'p-full', capabilities: ['a'], status: 'online', load: 1 }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-idle');
    });

    test('handles extreme latency values (0 and very high)', () => {
      reg.upsertPeer(makePeer({ id: 'p-zero', capabilities: ['a'], status: 'online', avgLatency: 0 }));
      reg.upsertPeer(makePeer({ id: 'p-high', capabilities: ['a'], status: 'online', avgLatency: 99999 }));
      const scores = reg.scorePeers(['a']);
      expect(scores[0].peerId).toBe('p-zero');
    });
  });
});
