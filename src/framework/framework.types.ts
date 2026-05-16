export type FrameworkType = 'react' | 'angular' | 'express' | 'php' | 'unknown';

export interface FrameworkDetectionResult {
  framework: FrameworkType;
  confidence: 'high' | 'medium' | 'low';
  nodeVersion?: string;
  phpVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDir?: string;
  port?: number;
}

export interface DockerfileGeneratorOptions {
  detection: FrameworkDetectionResult;
  port: number;
  envVars?: Record<string, string>;
}
