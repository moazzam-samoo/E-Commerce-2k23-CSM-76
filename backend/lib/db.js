import pg from 'pg';

// bigint ids come back as JS numbers (they are small); numeric (money) stays a STRING on purpose.
pg.types.setTypeParser(20, (v) => Number(v));

let pool;
export function getPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: 5,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}
