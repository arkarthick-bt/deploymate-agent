import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const val = process.env[name];
  return val ? parseInt(val, 10) : fallback;
}

export const env = {
  agentToken: required('AGENT_TOKEN'),
  serverId: optional('SERVER_ID', ''),

  backendWsUrl: optional('BACKEND_WS_URL', 'ws://localhost:8081/ws/agents'),
  backendHttpUrl: optional('BACKEND_HTTP_URL', 'http://localhost:8081'),

  docker: {
    socketPath: optional('DOCKER_SOCKET_PATH', '/var/run/docker.sock'),
    networkPrefix: optional('DOCKER_NETWORK_PREFIX', 'deploymate'),
    memoryLimit: optional('CONTAINER_MEMORY_LIMIT', '512m'),
    cpuLimit: optional('CONTAINER_CPU_LIMIT', '1'),
  },

  traefik: {
    network: optional('TRAEFIK_NETWORK', 'traefik-public'),
    domain: optional('TRAEFIK_DOMAIN', 'localhost'),
  },

  workspaceDir: optional('WORKSPACE_DIR', '/tmp/deploymate-agent/workspaces'),

  heartbeatIntervalMs: optionalNumber('HEARTBEAT_INTERVAL_MS', 30_000),
  deploymentTimeoutMs: optionalNumber('DEPLOYMENT_TIMEOUT_MS', 600_000),

  healthCheck: {
    retries: optionalNumber('HEALTH_CHECK_RETRIES', 10),
    intervalMs: optionalNumber('HEALTH_CHECK_INTERVAL_MS', 5_000),
    timeoutMs: optionalNumber('HEALTH_CHECK_TIMEOUT_MS', 30_000),
  },

  logLevel: optional('LOG_LEVEL', 'info'),
  nodeEnv: optional('NODE_ENV', 'development'),
};
