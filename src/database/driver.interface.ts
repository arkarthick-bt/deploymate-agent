import type { DbConnection } from '@/communication/protocol.types';

export interface DbUserInfo {
  username: string;
  host?: string;
  plugins?: string;
}

export interface DbSchemaInfo {
  name: string;
  owner?: string;
}

export interface DbDatabaseInfo {
  name: string;
  size?: string;
  owner?: string;
}

export interface DbPermissionInfo {
  grantee: string;
  privilege: string;
  table?: string;
  schema?: string;
  database?: string;
}

export interface ValidationResult {
  reachable: boolean;
  version?: string;
  currentUser?: string;
  sslEnabled?: boolean;
  latencyMs?: number;
  schemas?: string[];
}

export interface UserGrantSummary {
  username: string;
  host?: string;
  /** One entry per (schema or database) scope that has explicit grants */
  grants: Array<{
    /** Schema name (PostgreSQL) or database name (MySQL/MariaDB) */
    scope: string;
    privileges: string[];
  }>;
}

/**
 * Adapter interface every database driver must implement.
 * All methods receive the connection details and return structured data.
 * NEVER execute raw SQL strings from untrusted sources.
 */
export interface DatabaseDriver {
  /** Test connectivity and return server metadata. */
  validate(connection: DbConnection): Promise<ValidationResult>;

  /** List all users/roles visible from the connection. */
  listUsers(connection: DbConnection): Promise<DbUserInfo[]>;

  /** List all databases the connected user can see. */
  listDatabases(connection: DbConnection): Promise<DbDatabaseInfo[]>;

  /** List schemas within the connected database. */
  listSchemas(connection: DbConnection): Promise<DbSchemaInfo[]>;

  /** List effective permissions for all users. */
  listPermissions(connection: DbConnection): Promise<DbPermissionInfo[]>;

  /**
   * Create a new database user and apply the access template.
   * Template translates to engine-specific SQL (GRANT SELECT, etc.).
   */
  createUser(
    connection: DbConnection,
    username: string,
    password: string,
    template: string,
    targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void>;

  /** Revoke all privileges and drop the user. */
  revokeUser(connection: DbConnection, username: string): Promise<void>;

  /** Apply additional grants from a template to an existing user. */
  grantAccess(
    connection: DbConnection,
    username: string,
    template: string,
    targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void>;

  /** Revoke grants matching the template from an existing user. */
  revokeAccess(
    connection: DbConnection,
    username: string,
    template: string,
    targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void>;

  /** Change the password of the admin/connection user. */
  rotatePassword(connection: DbConnection, newPassword: string): Promise<void>;

  /**
   * Returns a single-query snapshot of all users and their grant scopes.
   * Used by the sync flow to reconcile live DB state into tracked tables.
   */
  getAccessSummary(connection: DbConnection): Promise<UserGrantSummary[]>;
}
