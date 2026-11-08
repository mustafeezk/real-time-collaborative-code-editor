import { rebaseUpdates } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { executeJava } from "./services/javaExecutionService.js";
import { createRoomCleanupService } from "./services/roomCleanupService.js";

const STARTER_CODE = `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}`;
const LEGACY_STARTER_CODE = 'console.log("Hello, world!");';
const MAX_UPDATE_COUNT = 200;
const MAX_UPDATE_BYTES = 500_000;
const MAX_JAVA_SOURCE_BYTES = 100_000;
const RUN_RESERVATION_TIMEOUT_MS = 15_000;
const RESULT_DISPLAY_ACK_TIMEOUT_MS = 5_000;

function deserializeUpdate(update) {
  if (
    !update ||
    typeof update.clientID !== "string" ||
    !update.changes ||
    typeof update.changes !== "object"
  ) {
    throw new Error("Invalid collaborative update");
  }

  return {
    clientID: update.clientID,
    changes: ChangeSet.fromJSON(update.changes),
  };
}

function deserializeStoredUpdate(row) {
  const serializedChanges = typeof row.changes === "string"
    ? JSON.parse(row.changes)
    : row.changes;
  return {
    clientID: row.clientId,
    changes: ChangeSet.fromJSON(serializedChanges),
  };
}

function serializeUpdate(update) {
  return {
    clientID: update.clientID,
    changes: update.changes.toJSON(),
  };
}

async function applyUpdates(pool, roomId, baseVersion, incomingUpdates) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [states] = await connection.execute(
      "SELECT code, version FROM RoomState WHERE roomId = ? FOR UPDATE",
      [roomId]
    );
    if (states.length === 0) {
      const error = new Error("Room state not found");
      error.syncRequired = true;
      throw error;
    }

    const currentVersion = Number(states[0].version);
    if (baseVersion > currentVersion) {
      const error = new Error("Client version is ahead of the room");
      error.syncRequired = true;
      throw error;
    }

    const [storedRows] = await connection.execute(
      `SELECT version, clientId, changes
       FROM RoomUpdate
       WHERE roomId = ? AND version > ? AND version <= ?
       ORDER BY version ASC`,
      [roomId, baseVersion, currentVersion]
    );
    if (storedRows.length !== currentVersion - baseVersion) {
      const error = new Error("Room update history is incomplete");
      error.syncRequired = true;
      throw error;
    }

    const interveningUpdates = storedRows.map(deserializeStoredUpdate);
    const acceptedUpdates = baseVersion === currentVersion
      ? incomingUpdates
      : rebaseUpdates(incomingUpdates, interveningUpdates);

    let document = Text.of(String(states[0].code || "").split("\n"));
    let nextVersion = currentVersion;
    for (const update of acceptedUpdates) {
      document = update.changes.apply(document);
      nextVersion += 1;
      await connection.execute(
        `INSERT INTO RoomUpdate (roomId, version, clientId, changes)
         VALUES (?, ?, ?, ?)`,
        [
          roomId,
          nextVersion,
          update.clientID,
          JSON.stringify(update.changes.toJSON()),
        ]
      );
    }

    if (acceptedUpdates.length > 0) {
      await connection.execute(
        "UPDATE RoomState SET code = ?, version = ? WHERE roomId = ?",
        [document.toString(), nextVersion, roomId]
      );
    }

    await connection.commit();
    return {
      baseVersion: currentVersion,
      version: nextVersion,
      updates: acceptedUpdates.map(serializeUpdate),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function attachRoomSockets(io, pool) {
  const roomQueues = new Map();
  const activeExecutions = new Map();
  const latestExecutionResults = new Map();
  const roomCleanup = createRoomCleanupService({
    io,
    pool,
    getPendingUpdates: (roomId) => roomQueues.get(roomId),
    isExecutionActive: (roomId) => activeExecutions.has(roomId),
    onRoomDeleted: (roomId) => {
      roomQueues.delete(roomId);
      activeExecutions.delete(roomId);
      latestExecutionResults.delete(roomId);
    },
  });

  function releaseExecution(roomId, executionId, reason) {
    const active = activeExecutions.get(roomId);
    if (!active || active.executionId !== executionId) return;
    clearTimeout(active.reservationTimer);
    activeExecutions.delete(roomId);
    io.to(roomId).emit("code:execution-unlocked", { roomId, executionId, reason });
  }

  async function publishExecutionResult(roomId, active, result) {
    latestExecutionResults.delete(roomId);
    latestExecutionResults.set(roomId, result);
    // Keep recent output for users who join while a run is finishing.
    while (latestExecutionResults.size > 100) {
      latestExecutionResults.delete(latestExecutionResults.keys().next().value);
    }

    try {
      await io.to(roomId)
        .timeout(RESULT_DISPLAY_ACK_TIMEOUT_MS)
        .emitWithAck("code:execution-result", result);
    } catch {
      // A disconnected or unresponsive participant must not lock the room forever.
    } finally {
      releaseExecution(roomId, active.executionId, "result-displayed");
    }
  }

  async function executeRoomSnapshot(roomId, active, code, documentVersion) {
    try {
      const pendingUpdates = roomQueues.get(roomId);
      if (pendingUpdates) await pendingUpdates.catch(() => {});

      const [states] = await pool.execute(
        "SELECT code, version FROM RoomState WHERE roomId = ? LIMIT 1",
        [roomId]
      );
      if (states.length === 0) throw new Error("Room state not found");

      const currentVersion = Number(states[0].version);
      if (
        !Number.isSafeInteger(currentVersion) ||
        currentVersion !== documentVersion ||
        String(states[0].code) !== code
      ) {
        await publishExecutionResult(roomId, active, {
          executionId: active.executionId,
          roomId,
          requestedBy: active.requestedBy,
          documentVersion,
          status: "Rejected",
          stdout: "",
          stderr: "The shared document changed before the run started. Wait for sync, then run again.",
          exitCode: null,
          executionTime: 0,
        });
        return;
      }

      const execution = await executeJava(code, active.executionId);
      await publishExecutionResult(roomId, active, {
        executionId: active.executionId,
        roomId,
        requestedBy: active.requestedBy,
        documentVersion,
        status: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
        exitCode: execution.exitCode,
        executionTime: execution.executionTime,
      });
    } catch (error) {
      console.error("Java execution request failed:", error);
      await publishExecutionResult(roomId, active, {
        executionId: active.executionId,
        roomId,
        requestedBy: active.requestedBy,
        documentVersion,
        status: "Infrastructure Error",
        stdout: "",
        stderr: "The Java execution service could not complete this request.",
        exitCode: null,
        executionTime: 0,
      });
    }
  }

  io.on("connection", (socket) => {
    socket.on("room:join", async ({ roomId, userName } = {}, acknowledge = () => {}) => {
      if (typeof roomId !== "string" || typeof userName !== "string" || !userName.trim()) {
        return acknowledge({ ok: false, message: "Room and display name are required" });
      }

      roomCleanup.beginJoin(roomId);
      let roomExists = false;
      let joined = false;

      try {
        await roomCleanup.runLifecycle(roomId, async () => {
          if (!socket.connected) return;
          const [rooms] = await pool.execute(
            "SELECT id FROM Room WHERE id = ? LIMIT 1",
            [roomId]
          );
          if (rooms.length === 0) {
            acknowledge({ ok: false, message: "Room not found" });
            return;
          }
          roomExists = true;

          await pool.execute(
            `INSERT IGNORE INTO RoomState (roomId, code, version)
             VALUES (?, ?, 0)`,
            [roomId, STARTER_CODE]
          );
          await pool.execute(
            `UPDATE RoomState
             SET code = ?
             WHERE roomId = ? AND version = 0 AND code = ?`,
            [STARTER_CODE, roomId, LEGACY_STARTER_CODE]
          );
          const [states] = await pool.execute(
            "SELECT code, version FROM RoomState WHERE roomId = ? LIMIT 1",
            [roomId]
          );

          if (!socket.connected) return;
          socket.data.roomId = roomId;
          socket.data.userName = userName.trim().slice(0, 100);
          await socket.join(roomId);
          if (!socket.connected) {
            await socket.leave(roomId);
            socket.data.roomId = null;
            socket.data.userName = null;
            return;
          }
          joined = true;
          const activeExecution = activeExecutions.get(roomId);
          const roomState = {
            ok: true,
            code: states[0].code,
            version: Number(states[0].version),
            activeExecution: activeExecution
              ? {
                  executionId: activeExecution.executionId,
                  roomId,
                  requestedBy: activeExecution.requestedBy,
                  documentVersion: activeExecution.documentVersion,
                  status: activeExecution.status,
                }
              : null,
            latestExecutionResult: latestExecutionResults.get(roomId) || null,
          };
          acknowledge(roomState);
          socket.emit("room:joined", { version: roomState.version });
        });
      } catch (error) {
        console.error("Socket room join error:", error);
        acknowledge({ ok: false, message: "Could not join room" });
      } finally {
        roomCleanup.finishJoin(roomId);
        if (roomExists && !joined) void roomCleanup.checkAfterLeave(roomId);
      }
    });

    socket.on("room:leave", async ({ roomId } = {}, acknowledge = () => {}) => {
      const joinedRoomId = socket.data.roomId;
      if (!joinedRoomId || (roomId && roomId !== joinedRoomId)) {
        return acknowledge({ ok: false, message: "Socket is not in that room" });
      }

      try {
        await socket.leave(joinedRoomId);
        socket.data.roomId = null;
        socket.data.userName = null;

        const active = activeExecutions.get(joinedRoomId);
        if (active?.socketId === socket.id && active.status === "Queued") {
          releaseExecution(joinedRoomId, active.executionId, "requester-left");
        }

        acknowledge({ ok: true });
        await roomCleanup.checkAfterLeave(joinedRoomId);
      } catch (error) {
        console.error(`Socket leave error for room ${joinedRoomId}:`, error);
        acknowledge({ ok: false, message: "Could not leave room" });
      }
    });

    socket.on("room:sync", async ({ version } = {}, acknowledge = () => {}) => {
      const roomId = socket.data.roomId;
      if (!roomId || !Number.isSafeInteger(version) || version < 0) {
        return acknowledge({ ok: false, message: "Invalid sync request" });
      }

      try {
        const [states] = await pool.execute(
          "SELECT version FROM RoomState WHERE roomId = ? LIMIT 1",
          [roomId]
        );
        if (states.length === 0) {
          return acknowledge({ ok: false, message: "Room state not found" });
        }

        const currentVersion = Number(states[0].version);
        if (version > currentVersion) {
          return acknowledge({ ok: false, message: "Client version is ahead of the room" });
        }

        const [rows] = await pool.execute(
          `SELECT version, clientId, changes
           FROM RoomUpdate
           WHERE roomId = ? AND version > ? AND version <= ?
           ORDER BY version ASC`,
          [roomId, version, currentVersion]
        );
        if (rows.length !== currentVersion - version) {
          return acknowledge({ ok: false, message: "Room update history is incomplete" });
        }

        return acknowledge({
          ok: true,
          baseVersion: version,
          version: currentVersion,
          updates: rows.map((row) => serializeUpdate(deserializeStoredUpdate(row))),
        });
      } catch (error) {
        console.error("Socket room sync error:", error);
        return acknowledge({ ok: false, message: "Could not sync room updates" });
      }
    });

    socket.on("room:push", async ({ version, updates } = {}, acknowledge = () => {}) => {
      const roomId = socket.data.roomId;
      if (
        !roomId ||
        !Number.isSafeInteger(version) ||
        version < 0 ||
        !Array.isArray(updates) ||
        updates.length === 0 ||
        updates.length > MAX_UPDATE_COUNT ||
        Buffer.byteLength(JSON.stringify(updates), "utf8") > MAX_UPDATE_BYTES
      ) {
        return acknowledge({ ok: false, message: "Invalid update batch" });
      }

      let queued;
      const previous = roomQueues.get(roomId) ?? Promise.resolve();
      queued = previous
        .catch(() => {})
        .then(async () => {
          const incomingUpdates = updates.map(deserializeUpdate);
          const batch = await applyUpdates(pool, roomId, version, incomingUpdates);
          if (batch.updates.length > 0) {
            socket.to(roomId).emit("room:updates", batch);
          }
          acknowledge({ ok: true, ...batch });
        })
        .catch((error) => {
          console.error("Socket OT update error:", error);
          acknowledge({
            ok: false,
            syncRequired: Boolean(error.syncRequired),
            message: error.message || "Could not apply room updates",
          });
        })
        .finally(() => {
          if (roomQueues.get(roomId) === queued) roomQueues.delete(roomId);
        });
      roomQueues.set(roomId, queued);
    });

    socket.on("code:run", ({ roomId } = {}, acknowledge = () => {}) => {
      if (
        typeof roomId !== "string" ||
        socket.data.roomId !== roomId ||
        !socket.rooms.has(roomId)
      ) {
        return acknowledge({ ok: false, message: "Join the room before running code" });
      }

      if (activeExecutions.has(roomId)) {
        return acknowledge({
          ok: false,
          busy: true,
          message: "Someone in this room is already running code",
        });
      }

      const active = {
        executionId: randomUUID(),
        roomId,
        socketId: socket.id,
        requestedBy: socket.data.userName,
        documentVersion: null,
        status: "Queued",
        reservationTimer: null,
      };
      active.reservationTimer = setTimeout(() => {
        releaseExecution(roomId, active.executionId, "run-request-expired");
      }, RUN_RESERVATION_TIMEOUT_MS);
      active.reservationTimer.unref();
      activeExecutions.set(roomId, active);

      io.to(roomId).emit("code:execution-status", {
        executionId: active.executionId,
        roomId,
        requestedBy: active.requestedBy,
        documentVersion: null,
        status: "Queued",
      });
      acknowledge({ ok: true, executionId: active.executionId });
    });

    socket.on("code:run:submit", ({ executionId, code, documentVersion } = {}, acknowledge = () => {}) => {
      const roomId = socket.data.roomId;
      const active = roomId ? activeExecutions.get(roomId) : null;
      if (!active || active.executionId !== executionId || active.socketId !== socket.id) {
        return acknowledge({ ok: false, message: "This run request is no longer active" });
      }
      if (
        typeof code !== "string" ||
        Buffer.byteLength(code, "utf8") > MAX_JAVA_SOURCE_BYTES ||
        !Number.isSafeInteger(documentVersion) ||
        documentVersion < 0
      ) {
        releaseExecution(roomId, executionId, "invalid-request");
        return acknowledge({ ok: false, message: "Invalid code or document version" });
      }

      clearTimeout(active.reservationTimer);
      active.reservationTimer = null;
      active.status = "Running";
      active.documentVersion = documentVersion;
      acknowledge({ ok: true, executionId });
      io.to(roomId).emit("code:execution-status", {
        executionId,
        roomId,
        requestedBy: active.requestedBy,
        documentVersion,
        status: "Running",
      });
      void executeRoomSnapshot(roomId, active, code, documentVersion);
    });

    socket.on("code:run:cancel", ({ executionId } = {}, acknowledge = () => {}) => {
      const roomId = socket.data.roomId;
      const active = roomId ? activeExecutions.get(roomId) : null;
      if (!active || active.executionId !== executionId || active.socketId !== socket.id) {
        return acknowledge({ ok: false, message: "This run request is no longer active" });
      }
      if (active.status !== "Queued") {
        return acknowledge({ ok: false, message: "The run has already started" });
      }
      releaseExecution(roomId, executionId, "cancelled");
      acknowledge({ ok: true });
    });

    socket.on("disconnect", () => {
      const roomId = socket.data.roomId;
      const active = roomId ? activeExecutions.get(roomId) : null;
      if (active?.socketId === socket.id && active.status === "Queued") {
        releaseExecution(roomId, active.executionId, "requester-disconnected");
      }
      if (roomId) void roomCleanup.checkAfterLeave(roomId);
    });
  });
}
