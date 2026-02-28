// importing tools from the pg (PostgreSQL) library - Pool keeps multiple connections open so we don't have to reconnect every request
import { Pool, QueryResult, QueryResultRow } from 'pg';
// establishing a connection to the database with the following credentials
const pool = new Pool({
    user: 'antoniomacias',
    host: 'localhost',
    database: 'iou_app',
    password: undefined,
    port: 5432,
});
// middleman wrapper function - lets every route in server.ts talk to the database through one place instead of connecting directly each time
export default {
    query: <T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> => pool.query(text, params)
};