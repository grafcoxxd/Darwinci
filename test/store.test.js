const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("../src/store");

test("lists and deletes in-memory rooms without crashing", async () => {
  const room = { code: "TESTA", updatedAt: Date.now(), players: [] };
  await store.saveRoom(room);

  assert.equal((await store.listRooms()).some((item) => item.code === room.code), true);
  await store.deleteRoom(room.code);
  assert.equal(await store.getRoom(room.code), null);
});
