import { Client as PgClient, ClientConfig as PgClientConfig } from 'pg';

type Config = string | PgClientConfig;

export type ClientConfig = Config | PgClient;

// neccessity for this client comes from the fact that PgClient requires dedicated call to PgClient.connect()
// in order to establish a connection
export class Client {
  private pg: PgClient;
  private config: Config;

  get isConnected() {
    return !!this.pg;
  }

  constructor(config: ClientConfig) {
    if (config instanceof PgClient) {
      this.pg = config;
    } else if (typeof config === 'string') {
      this.config = { connectionString: config };
    } else if (typeof config === 'object') {
      this.config = config;
    } else {
      throw new Error(`config argument should be either a connectionString, ClientConfig or instance of Client`);
    }
  }

  async getPgClient(): Promise<PgClient> {
    if (!this.isConnected) {
      this.pg = new PgClient(this.config);
      await this.pg.connect();
    }
    return this.pg;
  }

  async query(sql: string, values?: any[]) {
    const client = await this.getPgClient();
    return client.query(sql, values);
  }

  async close() {
    if (this.pg) {
      await this.pg.end();
    }
  }

  // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
  escapeIdentifier(str: string) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
  escapeLiteral(str: string) {
    let hasBackslash = false;
    let escaped = "'";

    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === "'") {
        escaped += c + c;
      } else if (c === '\\') {
        escaped += c + c;
        hasBackslash = true;
      } else {
        escaped += c;
      }
    }

    escaped += "'";

    if (hasBackslash === true) {
      escaped = ' E' + escaped;
    }

    return escaped;
  }
}
