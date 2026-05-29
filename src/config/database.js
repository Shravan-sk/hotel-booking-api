const Database = require('better-sqlite3');

const dbPath = process.env.SQLITE_DB_PATH || './hotel_booking.db';
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

const adaptValue = (value) => {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return value;
};

const replacePlaceholders = (sql) => sql.replace(/\$(\d+)/g, '?');

const parseJsonLikeValues = (rows) => rows.map((row) => {
  const parsedRow = { ...row };

  if (typeof parsedRow.amenities === 'string') {
    try {
      parsedRow.amenities = JSON.parse(parsedRow.amenities);
    } catch (error) {
      parsedRow.amenities = [];
    }
  }

  return parsedRow;
});

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    try {
      const normalizedSql = sql.trim().toUpperCase();
      const adaptedParams = params.map((value) => adaptValue(value));

      if (normalizedSql.startsWith('BEGIN') || normalizedSql.startsWith('COMMIT') || normalizedSql.startsWith('ROLLBACK')) {
        db.exec(sql);
        resolve({ rows: [], rowCount: 0 });
        return;
      }

      const preparedSql = replacePlaceholders(sql);

      if (normalizedSql.startsWith('SELECT')) {
        const stmt = db.prepare(preparedSql);
        const rows = stmt.all(...adaptedParams);
        const parsedRows = parseJsonLikeValues(rows);

        resolve({ rows: parsedRows, rowCount: parsedRows.length });
        return;
      }

      const stmt = db.prepare(preparedSql);
      const result = stmt.run(...adaptedParams);

      if (sql.toUpperCase().includes('RETURNING')) {
        const returningMatch = sql.match(/RETURNING\s+(.+)$/i);
        if (returningMatch) {
          const returningColumns = returningMatch[1].split(',').map((column) => column.trim()).filter(Boolean);
          const tableMatch = sql.match(/INSERT INTO\s+(\w+)/i) || sql.match(/UPDATE\s+(\w+)/i);

          if (tableMatch) {
            const tableName = tableMatch[1];
            let fallbackId = result.lastInsertRowid;

            if (/UPDATE\s+/i.test(sql)) {
              fallbackId = adaptedParams[adaptedParams.length - 1];
            }

            const returningQuery = `SELECT ${returningColumns.join(', ')} FROM ${tableName} WHERE id = ?`;
            const returningStmt = db.prepare(returningQuery);
            const returningRows = parseJsonLikeValues(returningStmt.all(fallbackId));
            resolve({ rows: returningRows, rowCount: returningRows.length });
            return;
          }
        }
      }

      resolve({ rows: [], rowCount: result.changes });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  query,
  db,
};
