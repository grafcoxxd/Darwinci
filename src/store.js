const { Pool } = require("pg");

let pool;
const memoryRooms = new Map();

async function initStore() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL fehlt. Bitte die Neon-Verbindungs-URL hinterlegen.");
    }
    console.warn("DATABASE_URL fehlt: lokaler Entwicklungsmodus nutzt nur Arbeitsspeicher.");
    return;
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
    max: 5
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_rooms (
      code TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS game_rooms_updated_idx ON game_rooms(updated_at)");
  await pool.end();
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
    max: 5
  });
}

async function getRoom(code) {
  if (!pool) return structuredClone(memoryRooms.get(code) || null);
  const result = await pool.query("SELECT state FROM game_rooms WHERE code = $1", [code]);
  return result.rows[0]?.state || null;
}

async function saveRoom(room) {
  room.updatedAt = Date.now();
  if (!pool) {
    memoryRooms.set(room.code, structuredClone(room));
    return;
  }
  await pool.query(
    `INSERT INTO game_rooms (code, state, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (code) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
    [room.code, room]
  );
}

async function listRooms() {
  if (!pool) return [...memoryRooms.values()].map(structuredClone);
  const result = await pool.query(
    "SELECT state FROM game_rooms WHERE updated_at > NOW() - INTERVAL '7 days'"
  );
  return result.rows.map((row) => row.state);
}

async function withRoom(code, operation) {
  if (!pool) {
    const room = structuredClone(memoryRooms.get(code) || null);
    if (!room) throw new Error("Lobby nicht gefunden.");
    await operation(room);
    memoryRooms.set(code, structuredClone(room));
    return room;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM game_rooms WHERE code = $1 FOR UPDATE", [code]);
    if (!result.rows[0]) throw new Error("Lobby nicht gefunden.");
    const room = result.rows[0].state;
    await operation(room);
    room.updatedAt = Date.now();
    await client.query(
      "UPDATE game_rooms SET state = $2, updated_at = NOW() WHERE code = $1",
      [code, room]
    );
    await client.query("COMMIT");
    return room;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closeStore() {
  if (pool) await pool.end();
}

module.exports = { closeStore, getRoom, initStore, listRooms, saveRoom, withRoom };
