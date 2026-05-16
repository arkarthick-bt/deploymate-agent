import 'dotenv/config';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { AgentWebSocketClient } from '@/websocket/agent.client';
import { metricsCollector } from '@/metrics/metrics.collector';
import { deploymentRunner } from '@/deployment/deployment.runner';
import { cleanupService } from '@/cleanup/cleanup.service';
import { assertDockerAvailable, getDockerVersion } from '@/docker/docker.client';
import type { BackendMessage } from '@/communication/protocol.types';
import fse from 'fs-extra';

async function bootstrap() {
  logger.info('Deploymate Agent starting...');

  // Validate Docker availability
  // await assertDockerAvailable();
  // const dockerVersion = await getDockerVersion();
  // logger.info({ dockerVersion }, 'Docker is available');
  const dockerVersion = '1.0.0';

  // Ensure workspace directory
  await fse.ensureDir(env.workspaceDir);
  logger.info({ workspaceDir: env.workspaceDir }, 'Workspace directory ready');

  const wsClient = new AgentWebSocketClient(env.backendWsUrl, env.agentToken);
  let heartbeatTimer: NodeJS.Timeout | null = null;

  wsClient.onConnect(async () => {
    logger.info('Connected to backend — registering agent');
    const metadata = await metricsCollector.getMetadata(dockerVersion);
    wsClient.send({ type: 'agent:register', metadata });

    // Start heartbeat
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      try {
        const metrics = await metricsCollector.getMetrics();
        wsClient.send({ type: 'agent:heartbeat', metrics });
      } catch (err) {
        logger.warn({ err }, 'Failed to send heartbeat');
      }
    }, env.heartbeatIntervalMs);
  });

  wsClient.onDisconnect(() => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  wsClient.onMessage(async (msg: BackendMessage) => {
    switch (msg.type) {
      case 'deployment:dispatch':
        logger.info({ deploymentId: msg.job.deploymentId }, 'Received deployment job');
        // Run deployment asynchronously — do not await so we can accept more jobs
        deploymentRunner.run(msg.job, (agentMsg) => wsClient.send(agentMsg)).catch((err) => {
          logger.error({ err, deploymentId: msg.job.deploymentId }, 'Deployment runner threw unexpectedly');
        });
        break;

      case 'deployment:rollback':
        logger.info({ deploymentId: msg.deploymentId }, 'Received rollback request');
        deploymentRunner
          .rollback(msg.deploymentId, msg.containerId, (agentMsg) => wsClient.send(agentMsg))
          .catch((err) => {
            logger.error({ err, deploymentId: msg.deploymentId }, 'Rollback failed');
          });
        break;

      default:
        logger.warn({ msg }, 'Unknown message from backend');
    }
  });

  wsClient.connect();

  // Periodic stale resource cleanup
  setInterval(() => {
    cleanupService.removeStaleContainers().catch((err) => {
      logger.warn({ err }, 'Stale container cleanup failed');
    });
  }, 60 * 60 * 1000); // every hour

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down agent');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    wsClient.terminate();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });

  logger.info('Agent initialized — waiting for deployment jobs');
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
