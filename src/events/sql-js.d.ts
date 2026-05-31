declare module 'sql.js' {
  export type SqlValue = string | number | Uint8Array | null;

  export interface Statement {
    bind(values?: SqlValue[] | Record<string, SqlValue>): boolean;
    step(): boolean;
    get(): SqlValue[];
    getAsObject(): Record<string, SqlValue>;
    run(values?: SqlValue[] | Record<string, SqlValue>): void;
    reset(): void;
    free(): boolean;
  }

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export class Database {
    constructor(data?: Uint8Array | null);
    run(sql: string, params?: SqlValue[] | Record<string, SqlValue>): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
