/**
 * Agent Mesh Network - Core Node Implementation
 * 
 * 去中心化的 AI Agent 协作网络核心实现
 */

import { createLibp2p, Libp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub, GossipSub } from '@chainsafe/libp2p-gossipsub';
import { identifyService } from '@libp2p/identify';
import { peerIdFromString } from '@libp2p/peer-id';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface MeshConfig {
  nodeId?: string;
  listenAddresses?: string[];
  bootstrapPeers?: string[];
  capabilities?: string[];
}

export interface MeshNode {
  id: string;
  publicKey: string;
  capabilities: string[];
  status: 'online' | 'busy' | 'offline';
  lastSeen: number;
  addresses: string[];
  peers: string[];
}

export type MessageType = 
  | 'task_request'
  | 'task_response'
  | 'task_bid'
  | 'capability_ad'
  | 'peer_list'
  | 'gossip'
  | 'heartbeat';

export interface MeshMessage {
  id: string;
  from: string;
  to?: string;
  type: MessageType;
  payload: any;
  timestamp: number;
  ttl: number;
  signature?: string;
}

export interface Task {
  id: string;
  type: string;
  payload: any;
  requiredCapabilities?: string[];
  timeout?: number;
  priority?: 'low' | 'normal' | 'high';
}

export interface TaskResult {
  taskId: string;
  nodeId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

export interface TaskBid {
  taskId: string;
  nodeId: string;
  estimatedTime: number;
  confidence: number;
  load: number;
}

export type CapabilityHandler = (task: Task) => Promise<any>;

// ============================================================================
// Events
// ============================================================================

export interface MeshEvents {
  'node:started': (nodeId: string) => void;
  'node:connected': (peerId: string) => void;
  'node:disconnected': (peerId: string) => void;
  'task:request': (task: Task, from: string) => void;
  'task:bid': (bid: TaskBid) => void;
  'task:result': (result: TaskResult) => void;
  'peer:discovered': (peer: MeshNode) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// MeshNode Implementation
// ============================================================================

export class MeshNetworkNode extends EventEmitter {
  private libp2p: Libp2p | null = null;
  private gossip: GossipSub | null = null;
  private capabilities: Map<string, CapabilityHandler> = new Map();
  private pendingTasks: Map<string, (result: TaskResult) => void> = new Map();
  private knownPeers: Map<string, MeshNode> = new Map();
  private config: MeshConfig;

  constructor(config: MeshConfig = {}) {
    super();
    this.config = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
      bootstrapPeers: [],
      capabilities: [],
      ...config
    };
  }

  /**
   * 启动 Mesh 节点
   */
  async start(): Promise<void> {
    // 创建 libp2p 节点
    this.libp2p = await createLibp2p({
      addresses: {
        listen: this.config.listenAddresses
      },
      transports: [webSockets()],
      streamMuxers: [yamux()],
      connectionEncryption: [noise()],
      dht: kadDHT({
        clientMode: false,
        validators: {
          capability: (key, value) => {
            // 验证能力注册
            return Promise.resolve();
          }
        }
      }),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: false
      }),
      services: {
        identify: identifyService()
      }
    });

    // 获取 gossip 实例
    this.gossip = this.libp2p.services.pubsub as GossipSub;

    // 监听连接事件
    this.libp2p.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      this.emit('node:connected', peerId);
      console.log(`✅ Connected to peer: ${peerId}`);
    });

    this.libp2p.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      this.emit('node:disconnected', peerId);
      console.log(`❌ Disconnected from peer: ${peerId}`);
    });

    // 订阅任务主题
    await this.gossip.subscribe('agent-mesh/tasks');
    await this.gossip.subscribe('agent-mesh/bids');
    await this.gossip.subscribe('agent-mesh/results');
    await this.gossip.subscribe('agent-mesh/capabilities');
    await this.gossip.subscribe('agent-mesh/heartbeat');

    // 监听消息
    this.gossip.addEventListener('message', (evt) => {
      this.handleMessage(evt.detail);
    });

    // 启动节点
    await this.libp2p.start();

    // 获取监听地址
    const multiaddrs = this.libp2p.getMultiaddrs();
    console.log('🌐 Mesh Node started:');
    multiaddrs.forEach(addr => {
      console.log(`   ${addr.toString()}`);
    });

    // 连接到种子节点
    for (const bootstrap of this.config.bootstrapPeers || []) {
      try {
        await this.connect(bootstrap);
      } catch (err) {
        console.warn(`⚠️  Failed to connect to bootstrap peer: ${bootstrap}`);
      }
    }

    // 广播能力
    await this.advertiseCapabilities();

    // 启动心跳
    this.startHeartbeat();

    this.emit('node:started', this.nodeId);
  }

  /**
   * 停止节点
   */
  async stop(): Promise<void> {
    if (this.libp2p) {
      await this.libp2p.stop();
      this.libp2p = null;
    }
    console.log('🛑 Mesh Node stopped');
  }

  /**
   * 连接到对等节点
   */
  async connect(multiaddr: string): Promise<void> {
    if (!this.libp2p) {
      throw new Error('Node not started');
    }

    const ma = multiaddr.startsWith('/') ? multiaddr : `/${multiaddr}`;
    console.log(`🔗 Connecting to ${ma}...`);
    
    await this.libp2p.dial(ma);
  }

  /**
   * 注册能力处理器
   */
  registerCapability(name: string, handler: CapabilityHandler): void {
    this.capabilities.set(name, handler);
    console.log(`📋 Registered capability: ${name}`);
    
    // 如果节点已启动，立即广播能力
    if (this.libp2p) {
      this.advertiseCapabilities().catch(console.error);
    }
  }

  /**
   * 广播能力到网络
   */
  private async advertiseCapabilities(): Promise<void> {
    if (!this.gossip) return;

    const message: MeshMessage = {
      id: this.generateId(),
      from: this.nodeId,
      type: 'capability_ad',
      payload: {
        capabilities: Array.from(this.capabilities.keys()),
        nodeId: this.nodeId,
        addresses: this.libp2p?.getMultiaddrs().map(a => a.toString()) || []
      },
      timestamp: Date.now(),
      ttl: 5
    };

    await this.gossip.publish(
      'agent-mesh/capabilities',
      Buffer.from(JSON.stringify(message))
    );
  }

  /**
   * 发布任务到网络
   */
  async publishTask(task: Task): Promise<TaskResult> {
    if (!this.gossip) {
      throw new Error('Node not started');
    }

    const message: MeshMessage = {
      id: this.generateId(),
      from: this.nodeId,
      type: 'task_request',
      payload: task,
      timestamp: Date.now(),
      ttl: 10
    };

    // 创建结果 Promise
    const resultPromise = new Promise<TaskResult>((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(task.id);
        reject(new Error('Task timeout'));
      }, task.timeout || 60000);

      this.pendingTasks.set(task.id, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
    });

    // 发布任务
    await this.gossip.publish(
      'agent-mesh/tasks',
      Buffer.from(JSON.stringify(message))
    );

    console.log(`📤 Published task: ${task.id} (${task.type})`);

    return resultPromise;
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: any): void {
    try {
      const topic = message.topic;
      const data = JSON.parse(message.data.toString());

      switch (topic) {
        case 'agent-mesh/tasks':
          this.handleTaskRequest(data);
          break;
        case 'agent-mesh/bids':
          this.handleTaskBid(data);
          break;
        case 'agent-mesh/results':
          this.handleTaskResult(data);
          break;
        case 'agent-mesh/capabilities':
          this.handleCapabilityAd(data);
          break;
        case 'agent-mesh/heartbeat':
          this.handleHeartbeat(data);
          break;
      }
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  }

  /**
   * 处理任务请求
   */
  private async handleTaskRequest(msg: MeshMessage): Promise<void> {
    const task: Task = msg.payload;

    // 检查是否是自己发布的任务
    if (msg.from === this.nodeId) {
      return;
    }

    // 检查是否有能力处理
    const handler = this.capabilities.get(task.type);
    if (!handler) {
      return;
    }

    console.log(`📥 Received task request: ${task.id} (${task.type})`);

    // 发送竞标
    const bid: TaskBid = {
      taskId: task.id,
      nodeId: this.nodeId,
      estimatedTime: 5000, // 预估 5 秒
      confidence: 0.9,
      load: this.capabilities.size / 10
    };

    await this.gossip?.publish(
      'agent-mesh/bids',
      Buffer.from(JSON.stringify({
        id: this.generateId(),
        from: this.nodeId,
        type: 'task_bid',
        payload: bid,
        timestamp: Date.now(),
        ttl: 5
      }))
    );
  }

  /**
   * 处理任务竞标
   */
  private handleTaskBid(msg: MeshMessage): void {
    const bid: TaskBid = msg.payload;
    this.emit('task:bid', bid);
    console.log(`💰 Received bid from ${bid.nodeId} for task ${bid.taskId}`);
  }

  /**
   * 处理任务结果
   */
  private handleTaskResult(msg: MeshMessage): void {
    const result: TaskResult = msg.payload;
    
    const callback = this.pendingTasks.get(result.taskId);
    if (callback) {
      callback(result);
      this.pendingTasks.delete(result.taskId);
    }
    
    this.emit('task:result', result);
    console.log(`✅ Task ${result.taskId} completed by ${result.nodeId}`);
  }

  /**
   * 处理能力广播
   */
  private handleCapabilityAd(msg: MeshMessage): void {
    const data = msg.payload;
    
    this.knownPeers.set(data.nodeId, {
      id: data.nodeId,
      publicKey: '',
      capabilities: data.capabilities,
      status: 'online',
      lastSeen: Date.now(),
      addresses: data.addresses,
      peers: []
    });

    this.emit('peer:discovered', this.knownPeers.get(data.nodeId)!);
  }

  /**
   * 处理心跳
   */
  private handleHeartbeat(msg: MeshMessage): void {
    const peer = this.knownPeers.get(msg.from);
    if (peer) {
      peer.lastSeen = Date.now();
      peer.status = 'online';
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    setInterval(async () => {
      if (!this.gossip) return;

      const message: MeshMessage = {
        id: this.generateId(),
        from: this.nodeId,
        type: 'heartbeat',
        payload: {
          timestamp: Date.now(),
          load: this.capabilities.size / 10
        },
        timestamp: Date.now(),
        ttl: 3
      };

      await this.gossip.publish(
        'agent-mesh/heartbeat',
        Buffer.from(JSON.stringify(message))
      );
    }, 30000); // 每 30 秒
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取节点 ID
   */
  get nodeId(): string {
    return this.libp2p?.peerId.toString() || 'unknown';
  }

  /**
   * 获取已知节点列表
   */
  getKnownPeers(): MeshNode[] {
    return Array.from(this.knownPeers.values());
  }

  /**
   * 获取网络统计
   */
  getStats(): {
    nodeId: string;
    peers: number;
    capabilities: number;
    pendingTasks: number;
  } {
    return {
      nodeId: this.nodeId,
      peers: this.libp2p?.getPeers().length || 0,
      capabilities: this.capabilities.size,
      pendingTasks: this.pendingTasks.size
    };
  }
}

export default MeshNetworkNode;
