/**
 * Agent Mesh Network - Basic Usage Example
 * 
 * 这个示例展示如何创建一个基本的 Mesh 节点
 */

import { MeshNetworkNode, Task } from '../src';

async function main() {
  console.log('🌐 Agent Mesh Network - Basic Example\n');

  // 创建节点
  const node = new MeshNetworkNode({
    listenAddresses: ['/ip4/0.0.0.0/tcp/0']
  });

  // 注册能力处理器
  node.registerCapability('echo', async (task: Task) => {
    console.log(`  Processing echo task: ${task.id}`);
    return { 
      echoed: task.payload,
      timestamp: Date.now()
    };
  });

  node.registerCapability('math', async (task: Task) => {
    const { operation, a, b } = task.payload;
    console.log(`  Processing math task: ${operation}(${a}, ${b})`);
    
    switch (operation) {
      case 'add':
        return { result: a + b };
      case 'multiply':
        return { result: a * b };
      case 'divide':
        return { result: a / b };
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  });

  node.registerCapability('text-analysis', async (task: Task) => {
    const text = task.payload.text || '';
    console.log(`  Processing text analysis task (${text.length} chars)`);
    
    return {
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      lineCount: text.split('\n').length,
      sentiment: analyzeSentiment(text)
    };
  });

  // 监听事件
  node.on('node:started', (nodeId) => {
    console.log(`✅ Node started: ${nodeId}\n`);
  });

  node.on('node:connected', (peerId) => {
    console.log(`✅ Peer connected: ${peerId.substring(0, 20)}...`);
  });

  node.on('task:request', (task, from) => {
    console.log(`\n📥 Task request from ${from.substring(0, 20)}...`);
    console.log(`   Type: ${task.type}`);
    console.log(`   ID: ${task.id}`);
  });

  node.on('task:result', (result) => {
    console.log(`\n✅ Task completed: ${result.taskId}`);
    console.log(`   Success: ${result.success}`);
  });

  // 启动节点
  await node.start();

  // 显示节点信息
  const stats = node.getStats();
  console.log('Node Information:');
  console.log(`  ID: ${stats.nodeId}`);
  console.log(`  Peers: ${stats.peers}`);
  console.log(`  Capabilities: ${stats.capabilities}`);
  console.log();

  // 示例：发布任务（如果有其他节点）
  if (process.env.PUBLISH_TEST_TASK === 'true') {
    console.log('📤 Publishing test task...');
    
    const task: Task = {
      id: `test-${Date.now()}`,
      type: 'echo',
      payload: { message: 'Hello, Mesh!' }
    };

    try {
      const result = await node.publishTask(task);
      console.log('Task result:', result);
    } catch (err: any) {
      console.log('Task failed:', err.message);
    }
  }

  // 保持运行
  console.log('\n💡 Press Ctrl+C to stop\n');

  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await node.stop();
    process.exit(0);
  });

  // 保持进程运行
  await new Promise(() => {});
}

// 简单的情感分析（演示用）
function analyzeSentiment(text: string): string {
  const positive = ['good', 'great', 'excellent', 'happy', 'love', 'wonderful'];
  const negative = ['bad', 'terrible', 'awful', 'sad', 'hate', 'horrible'];
  
  const lowerText = text.toLowerCase();
  const positiveCount = positive.filter(word => lowerText.includes(word)).length;
  const negativeCount = negative.filter(word => lowerText.includes(word)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

main().catch(console.error);
