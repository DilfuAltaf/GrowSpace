export interface QueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount?: number | null;
}

export interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R> | R[]>;
}

/**
 * Universal query runner supporting Client, Pool, neon() function, or in-memory mocks.
 * Robustly normalizes output whether the driver returns a pg-style { rows: [] } object
 * or a Neon-style array of rows.
 */
export async function executeQuery<R = Record<string, unknown>>(
  client: Queryable | ((sql: string, params?: unknown[]) => Promise<R[]>),
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<R>> {
  let result: unknown;

  if (typeof (client as Queryable).query === 'function') {
    result = await (client as Queryable).query<R>(sql, params);
  } else {
    result = await (client as (sql: string, params?: unknown[]) => Promise<R[]>)(sql, params);
  }

  if (Array.isArray(result)) {
    return { rows: result as R[], rowCount: result.length };
  }

  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as QueryResult<R>).rows)) {
    const qr = result as QueryResult<R>;
    return {
      rows: qr.rows,
      rowCount: qr.rowCount !== undefined ? qr.rowCount : qr.rows.length,
    };
  }

  return { rows: [], rowCount: 0 };
}
