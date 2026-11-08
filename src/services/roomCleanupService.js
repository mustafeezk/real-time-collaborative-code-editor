const ROOM_CLEANUP_GRACE_MS = 30_000;
const ROOM_CLEANUP_RETRY_MS = 5_000;

/**
 * Owns room presence grace periods and transactional removal of expired room data.
 * Socket handlers call beginJoin/finishJoin and checkAfterLeave around membership changes.
 */
export function createRoomCleanupService({
  io,
  pool,
  getPendingUpdates,
  isExecutionActive,
  onRoomDeleted,
}) {
  const cleanupTimers = new Map();
  const lifecycleQueues = new Map();
  const pendingJoins = new Map();

  function runLifecycle(roomId, operation) {
    const previous = lifecycleQueues.get(roomId) ?? Promise.resolve();
    let current;
    current = previous
      .catch(() => {})
      .then(operation)
      .finally(() => {
        if (lifecycleQueues.get(roomId) === current) {
          lifecycleQueues.delete(roomId);
        }
      });
    lifecycleQueues.set(roomId, current);
    return current;
  }

  function cancelPendingCleanup(roomId) {
    const timer = cleanupTimers.get(roomId);
    if (timer) clearTimeout(timer);
    cleanupTimers.delete(roomId);
  }

  function beginJoin(roomId) {
    cancelPendingCleanup(roomId);
    pendingJoins.set(roomId, (pendingJoins.get(roomId) || 0) + 1);
  }

  function finishJoin(roomId) {
    const remaining = (pendingJoins.get(roomId) || 0) - 1;
    if (remaining > 0) pendingJoins.set(roomId, remaining);
    else pendingJoins.delete(roomId);
  }

  async function hasRoomMembers(roomId) {
    const sockets = await io.in(roomId).fetchSockets();
    return sockets.length > 0;
  }

  async function scheduleIfEmpty(roomId, delay = ROOM_CLEANUP_GRACE_MS) {
    if (!roomId) return;
    if (pendingJoins.get(roomId) > 0 || await hasRoomMembers(roomId)) {
      cancelPendingCleanup(roomId);
      return;
    }
    if (cleanupTimers.has(roomId)) return;

    const timer = setTimeout(() => {
      cleanupTimers.delete(roomId);
      void cleanupIfEmpty(roomId);
    }, delay);
    timer.unref();
    cleanupTimers.set(roomId, timer);
  }

  async function cleanupIfEmpty(roomId) {
    try {
      const result = await runLifecycle(roomId, async () => {
        if (pendingJoins.get(roomId) > 0 || await hasRoomMembers(roomId)) {
          return "occupied";
        }
        if (isExecutionActive(roomId)) return "busy";

        const pendingUpdates = getPendingUpdates(roomId);
        if (pendingUpdates) await pendingUpdates.catch(() => {});
        if (pendingJoins.get(roomId) > 0 || await hasRoomMembers(roomId)) {
          return "occupied";
        }
        if (isExecutionActive(roomId)) return "busy";

        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            "SELECT id FROM Room WHERE id = ? FOR UPDATE",
            [roomId]
          );
          if (pendingJoins.get(roomId) > 0 || await hasRoomMembers(roomId)) {
            await connection.rollback();
            return "occupied";
          }
          if (isExecutionActive(roomId)) {
            await connection.rollback();
            return "busy";
          }

          await connection.execute("DELETE FROM RoomUpdate WHERE roomId = ?", [roomId]);
          await connection.execute("DELETE FROM RoomState WHERE roomId = ?", [roomId]);
          await connection.execute("DELETE FROM RoomParticipant WHERE roomId = ?", [roomId]);
          await connection.execute("DELETE FROM Room WHERE id = ?", [roomId]);
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }

        onRoomDeleted(roomId);
        cancelPendingCleanup(roomId);
        console.info(`Removed expired room ${roomId}`);
        return "deleted";
      });

      if (result === "busy") {
        await scheduleIfEmpty(roomId, ROOM_CLEANUP_RETRY_MS);
      } else if (result === "occupied") {
        await scheduleIfEmpty(roomId);
      }
    } catch (error) {
      console.error(`Could not remove expired room ${roomId}:`, error);
      await scheduleIfEmpty(roomId, ROOM_CLEANUP_RETRY_MS);
    }
  }

  async function checkAfterLeave(roomId) {
    try {
      await scheduleIfEmpty(roomId);
    } catch (error) {
      console.error(`Could not check room presence for ${roomId}:`, error);
    }
  }

  return {
    beginJoin,
    finishJoin,
    runLifecycle,
    cancelPendingCleanup,
    checkAfterLeave,
  };
}
