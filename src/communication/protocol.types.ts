// ------------------------------------------------------------------
// Shared protocol types between agent and backend WebSocket layer.
// Keep this file in sync with the backend's websocket.types.ts.
// ------------------------------------------------------------------

export type DeploymentState =
  | 'QUEUED'
  | 'CLONING'
  | 'DETECTING_FRAMEWORK'
  | 'GENERATING_DOCKERFILE'
  | 'BUILDING_IMAGE'
  | 'STARTING_CONTAINER'
  | 'HEALTH_CHECKING'
  | 'RUNNING'
  | 'FAILED'
  | 'ROLLING_BACK'
  | 'STOPPED';

export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

export interface ServerMetadata {
  hostname: string;
  platform: string;
  arch: string;
  cpuCores: number;
  totalMemoryMb: number;
  dockerVersion: string;
  agentVersion: string;
}

export interface ServerMetrics {
  cpuUsagePercent: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  loadAvg1m: number;
  uptime: number;
}

export interface DeploymentJob {
  deploymentId: string;
  projectId: string;
  projectSlug: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  commitSha: string;
  cloneUrl: string;
  environment: string;
  domain: string;
  port: number;
  envVars: Record<string, string>;
  resourceLimits: {
    memoryMb: number;
    cpuCount: number;
  };
  customDockerfile?: string;
}

// Agent → Backend
export type AgentMessage =
  | { type: 'agent:register'; metadata: ServerMetadata }
  | { type: 'agent:heartbeat'; metrics: ServerMetrics }
  | {
      type: 'deployment:state';
      deploymentId: string;
      state: DeploymentState;
      message?: string;
    }
  | {
      type: 'deployment:log';
      deploymentId: string;
      line: string;
      timestamp: string;
      level: LogLevel;
    }
  | {
      type: 'deployment:done';
      deploymentId: string;
      success: boolean;
      containerId?: string;
      containerName?: string;
      error?: string;
    };

// Backend → Agent
export type BackendMessage =
  | { type: 'deployment:dispatch'; job: DeploymentJob }
  | { type: 'deployment:rollback'; deploymentId: string; containerId: string }
  | { type: 'ping' };
