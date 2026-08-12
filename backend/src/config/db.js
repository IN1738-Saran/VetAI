// ============================================================================
// POSTGRESQL CONNECTION
// ============================================================================
import pkg from 'pg';
import {
    POSTGRES_USER,
    POSTGRES_HOST,
    POSTGRES_DB,
    POSTGRES_PASSWORD,
    POSTGRES_PORT,
} from './env.js';

const { Pool } = pkg;

// PostgreSQL Connection Pool
export const pool = new Pool({
    user: POSTGRES_USER,
    host: POSTGRES_HOST,
    database: POSTGRES_DB,
    password: POSTGRES_PASSWORD,
    port: POSTGRES_PORT,
});

// Test PostgreSQL connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ PostgreSQL connection error:', err.message);
    } else {
        console.log('✅ PostgreSQL connected successfully');
    }
});
