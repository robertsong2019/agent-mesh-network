# Agent Mesh Network Protocol Specification

**Version:** 0.1.0  
**Status:** Draft

## 1. Overview

Agent Mesh Network (AMN) 是一个去中心化的 AI Agent 协作协议，基于 libp2p 构建。

### 1.1 设计目标

- **去中心化**: 无中央服务器，所有节点平等
- **自组织**: 节点自动发现和连接
- **容错性**: 节点加入/离开不影响网络
- **隐私优先**: 端到端加密，无中间人
- **渐进式智能**: 本地优先，协作增强

### 1.2 核心技术

- **libp2p**: P2P 网络栈
- **Kademlia DHT**: 分布式哈希表
- **Gossip Sub**: 流言协议
- **Noise Protocol**: 加密通信

## 2. Network Topology

```
┌─────────────────────────────────────────────┐
│              Mesh Network                    │
│                                              │
│    Node A ←→ Node B ←→ Node C               │
│      ↑          ↑          ↑                │
│      └──────────┴──────────┘                │
│                                              │
│  - All nodes are equal                      │
│  - Gossip for message propagation            │
│  - DHT for capability discovery              │
└─────────────────────────────────────────────┘
```

## 3. Message Format

### 3.1 Base Message

```typescript
interface MeshMessage {
  id: string;           // 消息唯一 ID
  from: string;         // 发送者节点 ID
  to?: string;          // 接收者节点 ID（可选）
  type: MessageType;    // 消息类型
  payload: any;         // 消息负载
  timestamp: number;    // 时间戳（毫秒）
  ttl: number;          // 生存时间（跳数）
  signature?: string;   // 数字签名（可选）
}
```

### 3.2 Message Types

| Type | Description | Payload |
|------|-------------|---------|
| `task_request` | 任务请求 | `Task` |
| `task_response` | 任务响应 | `TaskResult` |
| `task_bid` | 任务竞标 | `TaskBid` |
| `capability_ad` | 能力广播 | `CapabilityAd` |
| `peer_list` | 节点列表 | `PeerList` |
| `gossip` | 流言消息 | `any` |
| `heartbeat` | 心跳 | `Heartbeat` |

## 4. Protocol Flows

### 4.1 Node Startup

```
Node                           Network
  │                               │
  │──── Start libp2p ────────────>│
  │                               │
  │──── Subscribe to topics ─────>│
  │  - agent-mesh/tasks           │
  │  - agent-mesh/bids            │
  │  - agent-mesh/results         │
  │  - agent-mesh/capabilities    │
  │  - agent-mesh/heartbeat       │
  │                               │
  │──── Connect to seeds ────────>│
  │                               │
  │──── Broadcast capabilities ──>│
  │                               │
  │<─── Receive peer list ────────│
  │                               │
  │──── Start heartbeat ─────────>│
```

### 4.2 Task Execution

```
Requester              Network              Worker
    │                     │                    │
    │─── task_request ───>│                    │
    │                     │─── gossip ────────>│
    │                     │                    │
    │                     │<── task_bid ───────│
    │<── task_bid ────────│                    │
    │                     │                    │
    │─── task_assign ────>│─── direct ────────>│
    │                     │                    │
    │                     │<── task_response ──│
    │<── task_response ───│                    │
```

### 4.3 Capability Discovery

```
Node A                 DHT                  Node B
   │                    │                     │
   │── put(cap:X) ─────>│                     │
   │                    │                     │
   │                    │<── get(cap:X) ──────│
   │                    │──── node A info ───>│
   │                    │                     │
   │<──── connect ──────┼─────────────────────│
```

## 5. Topics

| Topic | Purpose | Message Types |
|-------|---------|---------------|
| `agent-mesh/tasks` | 任务请求/响应 | task_request, task_response |
| `agent-mesh/bids` | 任务竞标 | task_bid |
| `agent-mesh/results` | 任务结果 | task_result |
| `agent-mesh/capabilities` | 能力广播 | capability_ad |
| `agent-mesh/heartbeat` | 节点心跳 | heartbeat |

## 6. DHT Keys

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `capability:{name}` | `[{nodeId, addresses}]` | 能力注册 |
| `node:{nodeId}` | `NodeInfo` | 节点信息 |
| `task:{taskId}` | `TaskResult` | 任务结果缓存 |

## 7. Security Model

### 7.1 Authentication

- 每个节点使用 Ed25519 密钥对
- 节点 ID 是公钥的 SHA-256 哈希
- 所有消息可选签名

### 7.2 Encryption

- 所有连接使用 Noise Protocol 加密
- 端到端加密通过 libp2p 提供
- 无需中间人

### 7.3 Trust Model

- **Public Network**: 任何节点可以加入
- **Private Network**: 需要预共享密钥
- **Web of Trust**: 基于信誉的信任模型（未来）

## 8. Capability System

### 8.1 Capability Registration

```typescript
interface CapabilityAd {
  nodeId: string;
  capabilities: string[];
  addresses: string[];
  load: number;
  timestamp: number;
}
```

### 8.2 Capability Matching

```typescript
// 任务指定所需能力
interface Task {
  requiredCapabilities?: string[];
}

// 节点检查是否匹配
function matchesCapability(task: Task, node: MeshNode): boolean {
  if (!task.requiredCapabilities) return true;
  return task.requiredCapabilities.every(
    cap => node.capabilities.includes(cap)
  );
}
```

## 9. Task Routing

### 9.1 Broadcast Strategy

- TTL 限制传播范围
- 优先传播到近邻
- 避免重复传播

### 9.2 Node Selection

```typescript
function selectBestNode(bids: TaskBid[]): TaskBid {
  return bids.sort((a, b) => {
    const scoreA = calculateScore(a);
    const scoreB = calculateScore(b);
    return scoreB - scoreA;
  })[0];
}

function calculateScore(bid: TaskBid): number {
  return (
    (1 - bid.load) * 0.3 +
    bid.confidence * 0.5 +
    (1 / bid.estimatedTime) * 0.2
  );
}
```

## 10. Fault Tolerance

### 10.1 Node Failure

- 心跳检测节点状态
- 超时自动移除节点
- 任务重新路由

### 10.2 Network Partition

- 最终一致性模型
- 分区恢复后同步状态
- DHT 自动修复

### 10.3 Task Failure

- 超时重试机制
- 指数退避
- 最多 3 次重试

## 11. Future Extensions

### 11.1 Planned Features

- [ ] WebRTC transport for browsers
- [ ] Bluetooth transport for IoT
- [ ] Payment channel integration
- [ ] Reputation system
- [ ] Privacy-preserving analytics

### 11.2 Research Topics

- Sybil attack resistance
- Incentive mechanisms
- Secure multi-party computation
- Zero-knowledge proofs

## 12. References

- [libp2p Specification](https://docs.libp2p.io/)
- [Kademlia DHT](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf)
- [Gossip Sub](https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/README.md)
- [Noise Protocol](https://noiseprotocol.org/noise.html)

---

**License:** MIT  
**Maintainers:** Agent Mesh Network Team
