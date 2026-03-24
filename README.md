# Agent Mesh Network 🌐🤖

> 去中心化的 AI Agent 协作网络

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![libp2p](https://img.shields.io/badge/libp2p-1.0+-orange.svg)](https://libp2p.io/)

## 🎯 概述

Agent Mesh Network (AMN) 是一个去中心化的 AI Agent 协作网络，让多个 AI Agent 可以像 BitTorrent 节点一样互相通信和协作，无需中央服务器。

### 核心特性

- 🔄 **去中心化** - 无中央服务器，所有节点平等
- 🌍 **自组织** - 节点自动发现和连接
- 🛡️ **容错性** - 节点加入/离开不影响网络
- 🔐 **隐私优先** - 端到端加密，无中间人
- ⚡ **渐进式智能** - 本地优先，协作增强

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────┐
│                    Agent Mesh Network                     │
│                                                           │
│    ┌───────┐         ┌───────┐         ┌───────┐        │
│    │Agent A│◄───────►│Agent B│◄───────►│Agent C│        │
│    │(Phone)│         │(Laptop)│        │(Server)│        │
│    └───┬───┘         └───┬───┘         └───┬───┘        │
│        │                 │                 │             │
│        │                 │                 │             │
│    ┌───▼───┐         ┌───▼───┐         ┌───▼───┐        │
│    │Agent D│◄───────►│Agent E│◄───────►│Agent F│        │
│    │(IoT)  │         │(Pi)   │         │(Cloud)│        │
│    └───────┘         └───────┘         └───────┘        │
│                                                           │
│  No central server. All nodes are equal.                 │
│  Gossip protocol for message propagation.                 │
│  DHT for capability discovery.                            │
└──────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/agent-mesh-network.git
cd agent-mesh-network

# 安装依赖
npm install

# 构建项目
npm run build
```

### 启动节点

```bash
# 启动第一个节点（种子节点）
npm run start -- --seed

# 启动其他节点，连接到种子节点
npm run start -- --bootstrap /ip4/127.0.0.1/tcp/4001/p2p/QmSeedNodeId
```

### 发布任务

```bash
# 发布一个代码审查任务
npm run task publish -- --type code-review --payload '{"code": "..."}'

# 查看网络状态
npm run status
```

## 📦 项目结构

```
agent-mesh-network/
├── spec/                         # 协议规范
│   ├── MESH-PROTOCOL.md         # 网络协议
│   ├── MESSAGE-FORMATS.md       # 消息格式
│   └── SECURITY.md              # 安全模型
│
├── src/                          # 源代码
│   ├── core/                     # 核心库
│   │   ├── node.ts              # Mesh Node 实现
│   │   ├── dht.ts               # DHT 实现
│   │   ├── gossip.ts            # Gossip 协议
│   │   └── crypto.ts            # 加密工具
│   │
│   ├── transports/               # 传输层实现
│   │   ├── webrtc.ts            # WebRTC (浏览器)
│   │   ├── websocket.ts         # WebSocket (服务器)
│   │   └── tcp.ts               # TCP (原生)
│   │
│   ├── agent/                    # Agent 集成
│   │   ├── mesh-agent.ts        # Mesh Agent 基类
│   │   ├── task-runner.ts       # 任务执行器
│   │   └── capability.ts        # 能力管理
│   │
│   └── cli/                      # 命令行工具
│       └── index.ts             # CLI 入口
│
├── examples/                     # 示例
│   ├── basic-node/              # 基础节点
│   ├── distributed-review/      # 分布式代码审查
│   └── smart-home-mesh/         # 智能家居 Mesh
│
└── dashboard/                    # 可视化面板
    └── mesh-visualizer.html     # 网络拓扑可视化
```

## 🎮 使用示例

### 基础节点

```typescript
import { MeshNode } from 'agent-mesh-network';

// 创建节点
const node = new MeshNode({
  nodeId: 'my-agent-001',
  capabilities: ['code-review', 'text-analysis']
});

// 启动节点
await node.start();

// 连接到网络
await node.connect('/ip4/1.2.3.4/tcp/4001/p2p/QmPeerId');

// 注册能力处理器
node.registerCapability('code-review', async (task) => {
  // 执行代码审查
  return { issues: [], score: 95 };
});

// 发布任务
const result = await node.publishTask({
  type: 'code-review',
  payload: { code: 'console.log("hello")' }
});

console.log(result);
```

### 分布式任务执行

```typescript
import { TaskRunner } from 'agent-mesh-network';

const runner = new TaskRunner(node);

// 复杂任务会自动分解并分发到网络中的多个节点
const result = await runner.executeDistributed({
  type: 'complex-analysis',
  subtasks: [
    { type: 'syntax-check', capability: 'code-analysis' },
    { type: 'security-scan', capability: 'security-audit' },
    { type: 'perf-analysis', capability: 'performance-testing' }
  ]
});
```

## 📊 网络可视化

启动可视化面板：

```bash
npm run dashboard
```

然后在浏览器中打开 `http://localhost:3000` 查看网络拓扑和实时状态。

## 🔬 技术细节

### 核心协议

- **libp2p** - P2P 网络栈
- **Kademlia DHT** - 分布式哈希表
- **Gossip Sub** - 流言协议
- **Noise Protocol** - 加密通信

### 消息格式

```typescript
interface MeshMessage {
  id: string;           // 消息 ID
  from: string;         // 发送者节点 ID
  to?: string;          // 接收者（可选）
  type: MessageType;    // 消息类型
  payload: any;         // 负载
  timestamp: number;    // 时间戳
  ttl: number;          // 跳数限制
  signature: string;    // 数字签名
}
```

### 能力发现

```typescript
// 注册能力
node.registerCapability('code-review', handler);

// DHT 自动记录
// Key: capability:code-review
// Value: [{ nodeId, addresses, load }]

// 查找能力
const nodes = await node.findCapability('code-review');
```

## 🌟 应用场景

- **分布式代码审查** - 多个专用节点并行审查代码
- **智能家居 Mesh** - IoT 设备直接协作，无需云端
- **研究协作网络** - 专业化 Agent 分工合作
- **边缘计算** - 本地节点协作处理数据
- **内容分发** - 去中心化内容缓存和分发

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解详情。

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

## 🔗 相关项目

- [libp2p](https://libp2p.io/) - 模块化 P2P 网络栈
- [IPFS](https://ipfs.io/) - 分布式文件系统
- [OpenClaw](https://github.com/yourusername/openclaw) - AI Agent 框架
- [Tiny Agent Protocol](https://github.com/yourusername/tap) - 轻量级 Agent 协议

---

**让 AI Agent 像 BitTorrent 一样去中心化协作 🌐🤖**
