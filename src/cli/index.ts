#!/usr/bin/env node

/**
 * Agent Mesh Network - CLI Tool
 * 
 * 命令行工具，用于管理 Mesh 节点
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import ora from 'ora';
import { MeshNetworkNode } from '../core/node';
import { Task } from '../core/node';

// ============================================================================
// Main CLI
// ============================================================================

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command('start', 'Start a mesh node', (yargs) => {
      return yargs
        .option('seed', {
          alias: 's',
          type: 'boolean',
          description: 'Start as seed node'
        })
        .option('bootstrap', {
          alias: 'b',
          type: 'string',
          description: 'Bootstrap peer multiaddr'
        })
        .option('port', {
          alias: 'p',
          type: 'number',
          default: 0,
          description: 'Listen port (0 for random)'
        });
    })
    .command('task <action>', 'Task management', (yargs) => {
      return yargs
        .positional('action', {
          choices: ['publish', 'list', 'cancel'],
          demandOption: true
        })
        .option('type', {
          alias: 't',
          type: 'string',
          description: 'Task type'
        })
        .option('payload', {
          type: 'string',
          description: 'Task payload (JSON)'
        });
    })
    .command('status', 'Show network status')
    .command('peers', 'List known peers')
    .command('capabilities', 'List registered capabilities')
    .demandCommand()
    .help()
    .alias('help', 'h')
    .argv;

  // Handle commands
  const command = argv._[0];

  switch (command) {
    case 'start':
      await handleStart(argv as any);
      break;
    case 'task':
      await handleTask(argv as any);
      break;
    case 'status':
      await handleStatus();
      break;
    case 'peers':
      await handlePeers();
      break;
    case 'capabilities':
      await handleCapabilities();
      break;
    default:
      console.log(chalk.red('Unknown command'));
      process.exit(1);
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleStart(argv: {
  seed?: boolean;
  bootstrap?: string;
  port?: number;
}) {
  console.log(chalk.bold.blue('\n🌐 Agent Mesh Network\n'));

  const spinner = ora('Starting mesh node...').start();

  const node = new MeshNetworkNode({
    listenAddresses: [`/ip4/0.0.0.0/tcp/${argv.port || 0}`],
    bootstrapPeers: argv.bootstrap ? [argv.bootstrap] : []
  });

  // Register some example capabilities
  node.registerCapability('echo', async (task) => {
    return { echo: task.payload };
  });

  node.registerCapability('code-review', async (task) => {
    // Simulate code review
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
      issues: [],
      score: 95,
      feedback: 'Code looks good!'
    };
  });

  node.registerCapability('text-analysis', async (task) => {
    const text = task.payload.text || '';
    return {
      wordCount: text.split(/\s+/).length,
      charCount: text.length,
      sentiment: 'positive'
    };
  });

  try {
    await node.start();
    spinner.succeed('Mesh node started successfully');

    console.log('\n' + chalk.bold('Node Information:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Node ID:    ${chalk.cyan(node.nodeId)}`);
    console.log(`  Capabilities: ${chalk.green(node.getStats().capabilities)}`);
    console.log(chalk.gray('─'.repeat(50)));

    console.log('\n' + chalk.bold('Listening for tasks...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await node.stop();
      process.exit(0);
    });

    // Handle task events
    node.on('task:request', (task, from) => {
      console.log(chalk.blue(`\n📥 Task request from ${from.substring(0, 20)}...`));
      console.log(chalk.gray(`   Type: ${task.type}`));
      console.log(chalk.gray(`   ID: ${task.id}`));
    });

    node.on('task:result', (result) => {
      if (result.success) {
        console.log(chalk.green(`\n✅ Task completed: ${result.taskId}`));
      } else {
        console.log(chalk.red(`\n❌ Task failed: ${result.taskId}`));
      }
    });

    node.on('node:connected', (peerId) => {
      console.log(chalk.green(`\n✅ Peer connected: ${peerId.substring(0, 20)}...`));
    });

    node.on('node:disconnected', (peerId) => {
      console.log(chalk.yellow(`\n⚠️  Peer disconnected: ${peerId.substring(0, 20)}...`));
    });

    // Keep process alive
    await new Promise(() => {});

  } catch (err: any) {
    spinner.fail('Failed to start mesh node');
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

async function handleTask(argv: {
  action: string;
  type?: string;
  payload?: string;
}) {
  if (argv.action === 'publish') {
    if (!argv.type) {
      console.log(chalk.red('Error: --type is required for task publish'));
      process.exit(1);
    }

    console.log(chalk.bold.blue('\n📤 Publishing Task\n'));

    const node = new MeshNetworkNode();
    await node.start();

    const task: Task = {
      id: `task-${Date.now()}`,
      type: argv.type,
      payload: argv.payload ? JSON.parse(argv.payload) : {}
    };

    console.log(chalk.gray('Task ID:'), task.id);
    console.log(chalk.gray('Type:'), task.type);
    console.log(chalk.gray('Payload:'), JSON.stringify(task.payload));
    console.log();

    const spinner = ora('Waiting for task completion...').start();

    try {
      const result = await node.publishTask(task);
      spinner.succeed('Task completed');

      console.log('\n' + chalk.bold('Result:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(JSON.stringify(result, null, 2));
      console.log(chalk.gray('─'.repeat(50)));

      await node.stop();
      process.exit(0);

    } catch (err: any) {
      spinner.fail('Task failed');
      console.error(chalk.red(err.message));
      await node.stop();
      process.exit(1);
    }
  } else {
    console.log(chalk.yellow('Task action not implemented yet:', argv.action));
  }
}

async function handleStatus() {
  console.log(chalk.bold.blue('\n📊 Network Status\n'));
  console.log(chalk.yellow('Note: Connect to a running mesh node to see status'));
  console.log();
}

async function handlePeers() {
  console.log(chalk.bold.blue('\n👥 Known Peers\n'));
  console.log(chalk.yellow('Note: Connect to a running mesh node to see peers'));
  console.log();
}

async function handleCapabilities() {
  console.log(chalk.bold.blue('\n📋 Registered Capabilities\n'));
  console.log(chalk.yellow('Note: Connect to a running mesh node to see capabilities'));
  console.log();
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
