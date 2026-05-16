export interface TraefikLabelOptions {
  serviceName: string;
  domain: string;
  port: number;
  traefikNetwork: string;
}

export function buildTraefikLabels(opts: TraefikLabelOptions): Record<string, string> {
  const { serviceName, domain, port } = opts;
  const safe = serviceName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${safe}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${safe}.entrypoints`]: 'web',
    [`traefik.http.services.${safe}.loadbalancer.server.port`]: String(port),
    'traefik.docker.network': opts.traefikNetwork,
    'deploymate.managed': 'true',
  };
}
