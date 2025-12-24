/// <reference types="node" />

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export type SqlValue = string | number | Uint8Array | null;

  export interface ParamsObject {
    [key: string]: SqlValue;
  }

  export interface Statement {
    bind(params?: SqlValue[] | ParamsObject | null): boolean;
    step(): boolean;
    getAsObject(params?: ParamsObject): ParamsObject;
    get(params?: SqlValue[] | ParamsObject | null): SqlValue[];
    getColumnNames(): string[];
    run(params?: SqlValue[] | ParamsObject | null): void;
    reset(): void;
    free(): boolean;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: SqlValue[] | ParamsObject | null): Database;
    exec(sql: string, params?: SqlValue[] | ParamsObject | null): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}

declare module 'node-cron' {
  export interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }

  export interface ScheduledTask {
    start: () => void;
    stop: () => void;
    destroy: () => void;
  }

  export function schedule(
    expression: string,
    func: () => void,
    options?: ScheduleOptions
  ): ScheduledTask;

  export function validate(expression: string): boolean;
}

declare module 'crc' {
  export function crc16(input: Buffer | string): number;
  export function crc32(input: Buffer | string): number;
  export function crc8(input: Buffer | string): number;
}
