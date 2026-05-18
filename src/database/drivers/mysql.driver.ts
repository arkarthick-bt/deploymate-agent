import mysql from 'mysql2/promise';
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
// Access template → MySQL privileges
// ---------------------------------------------------------------------------

const TEMPLATE_GRANTS: Record<string, string> = {
  READ_ONLY: 'SELECT',
  READ_WRITE: 'SELECT, INSERT, UPDATE, DELETE',
  ADMIN: 'ALL PRIVILEGES',
  MIGRATION: 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX',
};

async function withConnection<T>(
  connection: DbConnection,
  fn: (conn: mysql.Connection) => Promise<T>,
): Promise<T> {
  const conn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.sslEnabled ? {} : undefined,
    connectTimeout: 10_000,
  });

  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => { });
  }
}

export class MySQLDriver implements DatabaseDriver {
  async validate(connection: DbConnection): Promise<ValidationResult> {
    const start = Date.now();
    return withConnection(connection, async (conn) => {
      const [[versionRow]] = await conn.execute('SELECT VERSION() AS version') as any;
      const [[userRow]] = await conn.execute('SELECT CURRENT_USER() AS `current_user`') as any;
      const [[sslRow]] = await conn.execute("SHOW STATUS LIKE 'Ssl_cipher'") as any;
      const [databases] = await conn.execute(
        'SHOW DATABASES',
      ) as any;

      return {
        reachable: true,
        version: (versionRow as any)?.version as string,
        currentUser: (userRow as any)?.current_user as string,
        sslEnabled: !!(sslRow as any)?.Value,
        latencyMs: Date.now() - start,
        schemas: (databases as any[]).map((r: any) => r.Database as string),
      };
    });
  }

  async listUsers(connection: DbConnection): Promise<DbUserInfo[]> {
    return withConnection(connection, async (conn) => {
      const [rows] = await conn.execute(
        "SELECT User AS username, Host AS host, plugin AS plugins FROM mysql.user ORDER BY User",
      ) as any;
      return (rows as any[]).map((r) => ({
        username: r.username as string,
        host: r.host as string,
        plugins: r.plugins as string,
      }));
    });
  }

  async listDatabases(connection: DbConnection): Promise<DbDatabaseInfo[]> {
    return withConnection(connection, async (conn) => {
      const [rows] = await conn.execute('SHOW DATABASES') as any;
      return (rows as any[]).map((r) => ({ name: r.Database as string }));
    });
  }

  async listSchemas(connection: DbConnection): Promise<DbSchemaInfo[]> {
    // MySQL uses databases as schemas
    return this.listDatabases(connection);
  }

  async listPermissions(connection: DbConnection): Promise<DbPermissionInfo[]> {
    return withConnection(connection, async (conn) => {
      const [rows] = await conn.execute(
        `SELECT GRANTEE AS grantee, PRIVILEGE_TYPE AS privilege,
                TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`
         FROM   information_schema.TABLE_PRIVILEGES
         ORDER  BY GRANTEE, TABLE_SCHEMA, TABLE_NAME`,
      ) as any;
      return (rows as any[]).map((r) => ({
        grantee: r.grantee as string,
        privilege: r.privilege as string,
        schema: r.schema as string,
        table: r.table as string,
      }));
    });
  }

  async createUser(
    connection: DbConnection,
    username: string,
    password: string,
    template: string,
    targetDatabase?: string,
    _targetSchema?: string,
  ): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(username)) {
      throw new Error('Invalid MySQL username');
    }
    const db = targetDatabase ?? connection.database;
    const privs = TEMPLATE_GRANTS[template] ?? TEMPLATE_GRANTS['READ_ONLY']!;

    return withConnection(connection, async (conn) => {
      await conn.execute(`CREATE USER ?@'%' IDENTIFIED BY ?`, [username, password]);
      await conn.execute(`GRANT ${privs} ON \`${db}\`.* TO ?@'%'`, [username]);
      await conn.execute('FLUSH PRIVILEGES');
    });
  }

  async revokeUser(connection: DbConnection, username: string): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(username)) {
      throw new Error('Invalid MySQL username');
    }
    return withConnection(connection, async (conn) => {
      await conn.execute(`DROP USER IF EXISTS ?@'%'`, [username]);
      await conn.execute('FLUSH PRIVILEGES');
    });
  }

  async grantAccess(
    connection: DbConnection,
    username: string,
    template: string,
    targetDatabase?: string,
    _targetSchema?: string,
  ): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(username)) {
      throw new Error('Invalid MySQL username');
    }
    const db = targetDatabase ?? connection.database;
    const privs = TEMPLATE_GRANTS[template] ?? TEMPLATE_GRANTS['READ_ONLY']!;
    return withConnection(connection, async (conn) => {
      await conn.execute(`GRANT ${privs} ON \`${db}\`.* TO ?@'%'`, [username]);
      await conn.execute('FLUSH PRIVILEGES');
    });
  }

  async revokeAccess(
    connection: DbConnection,
    username: string,
    _template: string,
    targetDatabase?: string,
    _targetSchema?: string,
  ): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(username)) {
      throw new Error('Invalid MySQL username');
    }
    const db = targetDatabase ?? connection.database;
    return withConnection(connection, async (conn) => {
      await conn.execute(`REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ?@'%'`, [username]);
      await conn.execute('FLUSH PRIVILEGES');
    });
  }

  async getAccessSummary(connection: DbConnection): Promise<UserGrantSummary[]> {
    return withConnection(connection, async (conn) => {
      // Schema-level grants (most common: GRANT SELECT ON db.*)
      const [schemaRows] = await conn.execute(`
        SELECT
          REPLACE(GRANTEE, '\\'', '')              AS raw_grantee,
          SUBSTRING_INDEX(REPLACE(GRANTEE, '\\'', ''), '@', 1) AS username,
          SUBSTRING_INDEX(REPLACE(GRANTEE, '\\'', ''), '@', -1) AS host,
          TABLE_SCHEMA                              AS scope,
          GROUP_CONCAT(DISTINCT PRIVILEGE_TYPE)     AS privileges
        FROM information_schema.SCHEMA_PRIVILEGES
        WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
          AND GRANTEE NOT IN (
            "'mysql.sys'@'localhost'",
            "'mysql.session'@'localhost'",
            "'mysql.infoschema'@'localhost'"
          )
        GROUP BY raw_grantee, username, host, TABLE_SCHEMA
        ORDER BY username, TABLE_SCHEMA
      `) as any;

      // All login users (for users with no schema grants)
      const [userRows] = await conn.execute(
        `SELECT User AS username, Host AS host FROM mysql.user WHERE account_locked = 'N' ORDER BY User`,
      ) as any;

      const map = new Map<string, UserGrantSummary>();

      // Seed with all users first
      for (const row of userRows as any[]) {
        const key = `${row.username}@${row.host}`;
        if (!map.has(key)) {
          map.set(key, { username: row.username as string, host: row.host as string, grants: [] });
        }
      }

      // Layer in schema grants
      for (const row of schemaRows as any[]) {
        const key = `${row.username}@${row.host}`;
        if (!map.has(key)) {
          map.set(key, { username: row.username as string, host: row.host as string, grants: [] });
        }
        const privs: string[] = (row.privileges as string ?? '').split(',').map((p: string) => p.trim()).filter(Boolean);
        if (privs.length > 0) {
          map.get(key)!.grants.push({ scope: row.scope as string, privileges: privs });
        }
      }

      return Array.from(map.values());
    });
  }

  async rotatePassword(connection: DbConnection, newPassword: string): Promise<void> {
    const username = connection.username;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(username)) {
      throw new Error('Invalid MySQL username');
    }
    return withConnection(connection, async (conn) => {
      await conn.execute(`ALTER USER ?@'%' IDENTIFIED BY ?`, [username, newPassword]);
      await conn.execute('FLUSH PRIVILEGES');
    });
  }
}

export const mysqlDriver = new MySQLDriver();
