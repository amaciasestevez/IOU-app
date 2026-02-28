import { Pool, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
    user: 'antoniomacias',
    host: 'localhost',
    database: 'iou_app',
    password: undefined,
    port: 5432,
});

export default {
    query: <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> => pool.query(text, params)
};