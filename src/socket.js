const STARTER_CODE = 'console.log("Hello, world!");';
const MAX_CODE_BYTES = 1_000_000;
const SAVE_DELAY_MS = 500;

export function attachRoomSockets(io, pool) {
  const pendingCode = new Map();
  const pendingMeta = new Map();
  const saveTimers = new Map();
  const saveQueues = new Map();

  io.on("connection", (socket) => {
    socket.on("room:join", async ({ roomId, userName } = {}, acknowledge = () => {}) => {
      try {
        if (typeof roomId !== "string" || typeof userName !== "string" || !userName.trim()) {
          return acknowledge({ ok: false, message: "Room and display name are required" });
        }

        const [rooms] = await pool.execute(
          "SELECT id FROM Room WHERE id = ? LIMIT 1",
          [roomId]
        );
        if (rooms.length === 0) {
          return acknowledge({ ok: false, message: "Room not found" });
        }

        const [states] = await pool.execute(
          "SELECT code FROM RoomState WHERE roomId = ? LIMIT 1",
          [roomId]
        );

        socket.data.roomId = roomId;
        socket.data.userName = userName.trim().slice(0, 100);
        await socket.join(roomId);

        acknowledge({
          ok: true,
          code: pendingCode.get(roomId) ?? states[0]?.code ?? STARTER_CODE,
        });
      } catch (error) {
        console.error("Socket room join error:", error);
        acknowledge({ ok: false, message: "Could not join room" });
      }
    });

    socket.on("room:code", ({ code, version } = {}, acknowledge = () => {}) => {
      const roomId = socket.data.roomId;
      if (!roomId || typeof code !== "string") {
        return acknowledge({ ok: false, message: "Join a room before editing" });
      }
      if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
        return acknowledge({ ok: false, message: "Code exceeds the 1 MB limit" });
      }

      pendingCode.set(roomId, code);
      pendingMeta.set(roomId, { socketId: socket.id, version });
      socket.to(roomId).emit("room:code", {
        code,
        userName: socket.data.userName,
      });
      acknowledge({ ok: true });

      const currentTimer = saveTimers.get(roomId);
      if (currentTimer) clearTimeout(currentTimer);

      const timer = setTimeout(() => {
        saveTimers.delete(roomId);
        const codeToSave = pendingCode.get(roomId);
        const metaToSave = pendingMeta.get(roomId);
        const previousSave = saveQueues.get(roomId) ?? Promise.resolve();
        const nextSave = previousSave
          .catch(() => {})
          .then(async () => {
            await pool.execute(
              `INSERT INTO RoomState (roomId, code)
               VALUES (?, ?)
               ON DUPLICATE KEY UPDATE code = VALUES(code)`,
              [roomId, codeToSave]
            );
            io.to(roomId).emit("room:saved", {
              sourceSocketId: metaToSave?.socketId,
              version: metaToSave?.version,
            });
          })
          .catch((error) => {
            console.error("Socket code save error:", error);
            io.to(roomId).emit("room:save-error", {
              message: "Could not save room code",
            });
          });
        saveQueues.set(roomId, nextSave);
      }, SAVE_DELAY_MS);

      saveTimers.set(roomId, timer);
    });
  });
}
