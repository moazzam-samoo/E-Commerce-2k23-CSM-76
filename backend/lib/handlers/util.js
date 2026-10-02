import { ApiError } from '../errors.js';

export const notFound = (what) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

// Builds "update <table> set col = $2, ... where id = $1". Column names come ONLY
// from the validator's whitelist (never from user input), values are parameterised.
export async function updateRow(db, table, id, fields, jsonCols = []) {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => (jsonCols.includes(c) ? `${c} = $${i + 2}::jsonb` : `${c} = $${i + 2}`));
  const vals = cols.map((c) => (jsonCols.includes(c) ? JSON.stringify(fields[c]) : fields[c]));
  const r = await db.query(`update ${table} set ${sets.join(', ')} where id = $1 returning *`, [id, ...vals]);
  return r.rows[0];
}
