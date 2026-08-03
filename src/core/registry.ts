/**
 * MeshRegistry — Standalone peer capability registry.
 * 
 * Tracks which peers have which capabilities, supports matching
 * and scoring for task routing decisions. Pure logic, no networking.
 */

export interface PeerEntry {
  id: string;
  capabilities: string[];
  status: 'online' | 'busy' | 'offline';
  lastSeen: number;
  load: number;        // 0..1, current workload
  successRate: number; // 0..1, historical success rate
  avgLatency: number;  // ms, average task execution latency
}

export interface CapabilityScore {
  peerId: string;
  score: number;
  reasons: string[];
}

export class MeshRegistry {
  private peers: Map<string, PeerEntry> = new Map();

  /**
   * Register or update a peer entry
   */
  upsertPeer(entry: PeerEntry): void {
    this.peers.set(entry.id, { ...entry });
  }

  /**
   * Remove a peer
   */
  removePeer(peerId: string): boolean {
    return this.peers.delete(peerId);
  }

  /**
   * Get a single peer entry
   */
  getPeer(peerId: string): PeerEntry | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Check if peer exists
   */
  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  /**
   * Get all peers
   */
  getAllPeers(): PeerEntry[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get peer count
   */
  get size(): number {
    return this.peers.size;
  }

  /**
   * Get peers by status
   */
  getPeersByStatus(status: PeerEntry['status']): PeerEntry[] {
    return this.getAllPeers().filter(p => p.status === status);
  }

  /**
   * Update peer status
   */
  setPeerStatus(peerId: string, status: PeerEntry['status']): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    peer.status = status;
    peer.lastSeen = Date.now();
    return true;
  }

  /**
   * Update peer lastSeen timestamp
   */
  touchPeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    peer.lastSeen = Date.now();
    return true;
  }

  /**
   * Find peers with ALL required capabilities (AND match)
   */
  findPeersWithCapabilities(required: string[]): PeerEntry[] {
    return this.getAllPeers().filter(peer => {
      const caps = new Set(peer.capabilities);
      return required.every(r => caps.has(r));
    });
  }

  /**
   * Find peers with ANY of the required capabilities (OR match)
   */
  findPeersWithAnyCapability(required: string[]): PeerEntry[] {
    const requiredSet = new Set(required);
    return this.getAllPeers().filter(peer =>
      peer.capabilities.some(c => requiredSet.has(c))
    );
  }

  /**
   * Find peers matching capability AND online status
   */
  findAvailablePeers(requiredCapabilities: string[]): PeerEntry[] {
    return this.findPeersWithCapabilities(requiredCapabilities)
      .filter(p => p.status === 'online');
  }

  /**
   * Score peers for a given set of required capabilities.
   * Higher score = better match.
   * 
   * Scoring factors:
   * - Capability match ratio (exact > partial)
   * - Availability (online > busy > offline)
   * - Low load (prefer less loaded)
   * - High success rate
   * - Low latency
   */
  scorePeers(requiredCapabilities: string[], options?: {
    preferLowLoad?: boolean;
    preferHighSuccess?: boolean;
    preferLowLatency?: boolean;
  }): CapabilityScore[] {
    const peers = this.getAllPeers();
    const requiredSet = new Set(requiredCapabilities);
    const opts = {
      preferLowLoad: true,
      preferHighSuccess: true,
      preferLowLatency: true,
      ...options
    };

    return peers.map(peer => {
      const matched = peer.capabilities.filter(c => requiredSet.has(c));
      const matchRatio = requiredCapabilities.length > 0
        ? matched.length / requiredCapabilities.length
        : 1;
      
      const extraCapBonus = peer.capabilities.length > requiredCapabilities.length
        ? 0.05 * (peer.capabilities.length - requiredCapabilities.length)
        : 0;

      // Status factor
      const statusFactor = peer.status === 'online' ? 1.0
        : peer.status === 'busy' ? 0.5 : 0.1;

      // Load factor (lower is better)
      const loadFactor = opts.preferLowLoad ? (1 - peer.load) : 1;

      // Success rate factor
      const successFactor = opts.preferHighSuccess ? peer.successRate : 1;

      // Latency factor (normalize: assume 0-5000ms range, clamp)
      const latencyNorm = Math.min(peer.avgLatency / 5000, 1);
      const latencyFactor = opts.preferLowLatency ? (1 - latencyNorm) : 1;

      // Freshness: more recent lastSeen = slightly higher score
      const age = Date.now() - peer.lastSeen;
      const freshnessFactor = age < 60000 ? 1.0
        : age < 300000 ? 0.9 : 0.7;

      const score = matchRatio * statusFactor * loadFactor *
        successFactor * latencyFactor * freshnessFactor + extraCapBonus;

      const reasons: string[] = [];
      if (matched.length === requiredCapabilities.length) reasons.push('exact-capability-match');
      else if (matched.length > 0) reasons.push(`partial-match(${matched.length}/${requiredCapabilities.length})`);
      if (peer.status === 'online') reasons.push('online');
      if (peer.load < 0.3) reasons.push('low-load');
      if (peer.successRate > 0.9) reasons.push('high-success');

      return { peerId: peer.id, score, reasons };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Get the best peer for a task (highest score)
   */
  getBestPeer(requiredCapabilities: string[], options?: Parameters<typeof this.scorePeers>[1]): CapabilityScore | null {
    const scores = this.scorePeers(requiredCapabilities, options);
    return scores.length > 0 ? scores[0] : null;
  }

  /**
   * Record task execution result for a peer (update success rate and latency)
   */
  recordResult(peerId: string, success: boolean, latencyMs: number): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    // Exponential moving average for success rate
    const alpha = 0.2;
    peer.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * peer.successRate;
    // EMA for latency
    peer.avgLatency = alpha * latencyMs + (1 - alpha) * peer.avgLatency;
  }

  /**
   * Get all unique capabilities across all peers
   */
  getAllCapabilities(): string[] {
    const caps = new Set<string>();
    for (const peer of this.peers.values()) {
      peer.capabilities.forEach(c => caps.add(c));
    }
    return Array.from(caps).sort();
  }

  /**
   * Find peers that haven't been seen since `threshold` ms ago
   */
  getStalePeers(thresholdMs: number): PeerEntry[] {
    const cutoff = Date.now() - thresholdMs;
    return this.getAllPeers().filter(p => p.lastSeen < cutoff);
  }

  /**
   * Clear all peers
   */
  clear(): void {
    this.peers.clear();
  }
}

export default MeshRegistry;
