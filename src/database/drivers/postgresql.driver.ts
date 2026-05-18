import { Client } from 'pg';
import type { DbConnection } from '@/communication/protocol.types';
import type {
  DatabaseDriver,
  ValidationResult,
  DbUserInfo,
  DbDatabaseInfo,
  DbSchemaInfo,
  DbPermissionInfo,
  UserGrantSummary,
} from '../driver.interface';

// ---------------------------------------------------------------------------
// Access template → PostgreSQL privileges
// ---------------------------------------------------------------------------

const TEMPLATE_GRANTS: Record<string, string[]> = {
  READ_ONLY:  ['CONNECT', 'SELECT'],
  READ_WRITE: ['CONNECT', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  ADMIN:      ['ALL PRIVILEGES'],
  MIGRATION:  ['CONNECT', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'],
};

async function withClient<T>(
  connection: DbConnection,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.sslEnabled ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export class PostgreSQLDriver implements DatabaseDriver {
  async validate(connection: DbConnection): Promise<ValidationResult> {
    const start = Date.now();
    return withClient(connection, async (client) => {
      const [versionRow] = (await client.query('SELECT version()'))
        .rows as [{ version: string }];
      const [userRow] = (await client.query('SELECT current_user'))
        .rows as [{ current_user: string }];
      const [sslRow] = (await client.query("SHOW ssl"))
        .rows as [{ ssl: string }];
      const schemas = (
        await client.query(
          "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name",
        )
      ).rows.map((r: any) => r.schema_name as string);

      return {
        reachable: true,
        version: versionRow?.version,
        currentUser: userRow?.current_user,
        sslEnabled: sslRow?.ssl === 'on',
        latencyMs: Date.now() - start,
        schemas,
      };
    });
  }

  async listUsers(connection: DbConnection): Promise<DbUserInfo[]> {
    return withClient(connection, async (client) => {
      const result = await client.query(
        'SELECT rolname AS username FROM pg_roles WHERE rolcanlogin = true ORDER BY rolname',
      );
      return result.rows.map((r: any) => ({ username: r.username as string }));
    });
  }

  async listDatabases(connection: DbConnection): Promise<DbDatabaseInfo[]> {
    return withClient(connection, async (client) => {
      const result = await client.query(
        "SELECT datname AS name, pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datistemplate = false ORDER BY datname",
      );
      return result.rows.map((r: any) => ({ name: r.name as string, owner: r.owner as string }));
    });
  }

  async listSchemas(connection: DbConnection): Promise<DbSchemaInfo[]> {
    return withClient(connection, async (client) => {
      const result = await client.query(
        "SELECT schema_name AS name, schema_owner AS owner FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name",
      );
      return result.rows.map((r: any) => ({ name: r.name as string, owner: r.owner as string }));
    });
  }

  async listPermissions(connection: DbConnection): Promise<DbPermissionInfo[]> {
    return withClient(connection, async (client) => {
      const result = await client.query(
        `SELECT grantee, privilege_type AS privilege, table_name AS "table",
                table_schema AS schema
         FROM   information_schema.role_table_grants
         WHERE  grantee NOT IN ('PUBLIC','pg_monitor','pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables','pg_signal_backend')
         ORDER  BY grantee, table_schema, table_name`,
      );
      return result.rows.map((r: any) => ({
        grantee: r.grantee as string,
        privilege: r.privilege as string,
        table: r.table as string,
        schema: r.schema as string,
      }));
    });
  }

  async createUser(
    connection: DbConnection,
    username: string,
    password: string,
    template: string,
    targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void> {
    // Sanitize: only alphanumeric + underscore usernames
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
      throw new Error('Invalid PostgreSQL username');
    }
    return withClient(connection, async (client) => {
      // Create role
      await client.query(`CREATE USER "${username}" WITH PASSWORD $1`, [password]);
      await this._applyGrants(client, username, template, targetSchema);
    });
  }

  async revokeUser(connection: DbConnection, username: string): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
      throw new Error('Invalid PostgreSQL username');
    }
    return withClient(connection, async (client) => {
      // Revoke all privileges first to avoid dependency errors
      await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "${username}"`).catch(() => {});
      await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "${username}"`).catch(() => {});
      await client.query(`REVOKE CONNECT ON DATABASE "${connection.database}" FROM "${username}"`).catch(() => {});
      await client.query(`DROP USER IF EXISTS "${username}"`);
    });
  }

  async grantAccess(
    connection: DbConnection,
    username: string,
    template: string,
    _targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
      throw new Error('Invalid PostgreSQL username');
    }
    return withClient(connection, async (client) => {
      await this._applyGrants(client, username, template, targetSchema);
    });
  }

  async revokeAccess(
    connection: DbConnection,
    username: string,
    _template: string,
    _targetDatabase?: string,
    targetSchema?: string,
  ): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
      throw new Error('Invalid PostgreSQL username');
    }
    const schema = targetSchema ?? 'public';
    return withClient(connection, async (client) => {
      await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" FROM "${username}"`);
    });
  }

  async rotatePassword(connection: DbConnection, newPassword: string): Promise<void> {
    const username = connection.username;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(username)) {
      throw new Error('Invalid PostgreSQL username');
    }
    return withClient(connection, async (client) => {
      await client.query(`ALTER USER "${username}" WITH PASSWORD $1`, [newPassword]);
    });
  }

  async getAccessSummary(connection: DbConnection): Promise<UserGrantSummary[]> {
    return withClient(connection, async (client) => {
      // Per-user, per-schema privilege aggregation.
      // Excludes superusers and internal pg_ roles.
      const result = await client.query(`
        SELECT
          g.grantee                            AS username,
          g.table_schema                       AS scope,
          array_agg(DISTINCT g.privilege_type) AS privileges
        FROM information_schema.role_table_grants g
        JOIN pg_roles r ON r.rolname = g.grantee
        WHERE r.rolcanlogin = true
          AND r.rolsuper    = false
          AND g.grantee NOT LIKE 'pg_%'
        GROUP BY g.grantee, g.table_schema
        ORDER BY g.grantee, g.table_schema
      `);

      // Group rows by username
      const map = new Map<string, UserGrantSummary>();
      for (const row of result.rows as any[]) {
        const username = row.username as string;
        if (!map.has(username)) map.set(username, { username, grants: [] });
        const privs: string[] = Array.isArray(row.privileges) ? row.privileges : [];
        if (privs.length > 0) {
          map.get(username)!.grants.push({ scope: row.scope as string, privileges: privs });
        }
      }

      // Also include users that have no table grants (login roles with no grants yet)
      const loginRoles = await client.query(
        `SELECT rolname AS username FROM pg_roles WHERE rolcanlogin = true AND rolsuper = false AND rolname NOT LIKE 'pg_%' ORDER BY rolname`,
      );
      for (const row of loginRoles.rows as any[]) {
        if (!map.has(row.username as string)) {
          map.set(row.username as string, { username: row.username as string, grants: [] });
        }
      }

      return Array.from(map.values());
    });
  }

  private async _applyGrants(
    client: Client,
    username: string,
    template: string,
    targetSchema?: string,
  ): Promise<void> {
    const schema = targetSchema ?? 'public';
    const privs = TEMPLATE_GRANTS[template] ?? TEMPLATE_GRANTS['READ_ONLY']!;

    if (privs.includes('CONNECT')) {
      await client.query(`GRANT CONNECT ON DATABASE "${client.database}" TO "${username}"`);
    }
    if (privs.includes('ALL PRIVILEGES')) {
      await client.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schema}" TO "${username}"`);
      await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${username}"`);
    } else {
      const tablePrivs = privs.filter((p) => p !== 'CONNECT');
      if (tablePrivs.length > 0) {
        await client.query(
          `GRANT ${tablePrivs.join(', ')} ON ALL TABLES IN SCHEMA "${schema}" TO "${username}"`,
        );
      }
    }
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${username}"`);
  }
}

export const postgresqlDriver = new PostgreSQLDriver();
