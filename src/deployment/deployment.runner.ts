import path from 'path';
import fse from 'fs-extra';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { gitService } from '@/git/git.service';
import { frameworkDetector } from '@/framework/detector';
import { generateDockerfile } from '@/framework/dockerfile.generator';
import { buildImage, removeImage } from '@/docker/docker.builder';
import { runContainer, stopContainer, findContainerByLabel } from '@/docker/docker.runtime';
import { ensureNetwork, projectNetworkName } from '@/docker/docker.network';
import { runHealthCheck } from '@/health/health.checker';
import type { AgentMessage, DeploymentJob, DeploymentState } from '@/communication/protocol.types';

type SendFn = (msg: AgentMessage) => boolean;

export class DeploymentRunner {
  private activeDeployments = new Map<string, AbortController>();

  async run(job: DeploymentJob, send: SendFn): Promise<void> {
    const ac = new AbortController();
    this.activeDeployments.set(job.deploymentId, ac);

    const workspaceDir = path.join(env.workspaceDir, job.deploymentId);
    const imageName = `deploymate-${job.projectSlug}`;
    const imageTag = job.commitSha.slice(0, 8);
    const containerName = `dm-${job.projectSlug}-${job.environment}`;

    const log = (line: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info') => {
      logger[level](line);
      send({
        type: 'deployment:log',
        deploymentId: job.deploymentId,
        line,
        timestamp: new Date().toISOString(),
        level: level === 'warn' ? 'info' : level,
      });
    };

    const setState = (state: DeploymentState, message?: string) => {
      send({ type: 'deployment:state', deploymentId: job.deploymentId, state, message });
    };

    try {
      // 1. Clone
      setState('CLONING', 'Cloning repository...');
      log(`Cloning ${job.repositoryOwner}/${job.repositoryName}@${job.branch}`);
      await gitService.clone({
        cloneUrl: job.cloneUrl,
        branch: job.branch,
        commitSha: job.commitSha,
        destDir: workspaceDir,
      });
      log('Repository cloned successfully');

      // 2. Detect framework
      setState('DETECTING_FRAMEWORK', 'Detecting framework...');
      const detection = await frameworkDetector.detect(workspaceDir);
      const effectivePort = job.port || detection.port || 3000;
      log(`Detected framework: ${detection.framework} (port: ${effectivePort})`);

      // 3. Generate Dockerfile
      setState('GENERATING_DOCKERFILE', 'Generating Dockerfile...');
      await generateDockerfile(workspaceDir, detection, effectivePort, job.customDockerfile);
      log('Dockerfile ready');

      // 4. Build image
      setState('BUILDING_IMAGE', 'Building Docker image...');
      const fullTag = await buildImage({
        contextDir: workspaceDir,
        imageName,
        imageTag,
        onLog: (line) => log(line, 'debug'),
      });
      log(`Image built: ${fullTag}`);

      // 5. Prepare network
      const networkName = projectNetworkName(env.docker.networkPrefix, job.projectSlug);
      await ensureNetwork(networkName);

      // 6. Stop previous container if exists
      const existing = await findContainerByLabel('deploymate.project', job.projectSlug);
      if (existing) {
        log(`Stopping previous container: ${existing.Names[0]}`);
        await stopContainer(existing.Id);
      }

      // 7. Start container
      setState('STARTING_CONTAINER', 'Starting container...');
      const container = await runContainer({
        imageName: fullTag,
        containerName,
        projectNetwork: networkName,
        domain: job.domain,
        port: effectivePort,
        envVars: job.envVars,
        memoryMb: job.resourceLimits.memoryMb || 512,
        cpuCount: job.resourceLimits.cpuCount || 1,
      });
      log(`Container started: ${container.name}`);

      // 8. Health check
      setState('HEALTH_CHECKING', 'Running health checks...');
      const healthy = await runHealthCheck({
        containerName: container.name,
        port: effectivePort,
        path: '/',
      });

      if (!healthy) {
        throw new Error('Health check failed — container is not responding');
      }

      log('Health check passed — deployment successful');
      setState('RUNNING', 'Deployment running');

      send({
        type: 'deployment:done',
        deploymentId: job.deploymentId,
        success: true,
        containerId: container.id,
        containerName: container.name,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, deploymentId: job.deploymentId }, 'Deployment failed');
      log(`DEPLOYMENT FAILED: ${message}`, 'error');
      setState('FAILED', message);
      send({
        type: 'deployment:done',
        deploymentId: job.deploymentId,
        success: false,
        error: message,
      });
    } finally {
      this.activeDeployments.delete(job.deploymentId);
      // Clean up workspace
      try {
        await fse.remove(workspaceDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async rollback(deploymentId: string, containerId: string, send: SendFn): Promise<void> {
    send({ type: 'deployment:state', deploymentId, state: 'ROLLING_BACK' });
    try {
      await stopContainer(containerId);
      send({ type: 'deployment:state', deploymentId, state: 'STOPPED', message: 'Rollback complete' });
      send({ type: 'deployment:done', deploymentId, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'deployment:state', deploymentId, state: 'FAILED', message });
      send({ type: 'deployment:done', deploymentId, success: false, error: message });
    }
  }

  abort(deploymentId: string): void {
    const ac = this.activeDeployments.get(deploymentId);
    if (ac) {
      ac.abort();
      this.activeDeployments.delete(deploymentId);
    }
  }
}

export const deploymentRunner = new DeploymentRunner();
