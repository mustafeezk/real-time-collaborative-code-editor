
import { randomUUID } from "node:crypto";
import pool from "../config/db.js";

async function createRoom(req, res) {
  try {
    const { userName, roomName } = req.body;

    // 1. Validate the request
    if (
      typeof userName !== "string" ||
      !userName.trim() ||
      typeof roomName !== "string" ||
      !roomName.trim()
    ) {
      return res.status(400).json({
        message: "userName and roomName are required",
      });
    }

    const cleanUserName = userName.trim();
    const cleanRoomName = roomName.trim();

    if (cleanUserName.length > 100 ||
        cleanRoomName.length > 100) {
      return res.status(400).json({
        message: "Names must be 100 characters or fewer",
      });
    }

    // 2. Generate a unique room ID
    const roomId = randomUUID();

    // 3. Save the room in MySQL
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT INTO Room (id, name, createdByName)
         VALUES (?, ?, ?)`,
        [roomId, cleanRoomName, cleanUserName]
      );

      await connection.execute(
        `INSERT INTO RoomState (roomId, code)
         VALUES (?, ?)`,
        [roomId, 'console.log("Hello, world!");']
      );

      // 4. Save the creator as the first participant
      await connection.execute(
        `INSERT INTO RoomParticipant (id, userName, roomId)
         VALUES (?, ?, ?)`,
        [randomUUID(), cleanUserName, roomId]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    // 5. Return the shareable URL
    const frontendUrl = (
      `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");

    return res.status(201).json({
      message: "Room created successfully",
      room: {
        id: roomId,
        name: cleanRoomName,
        createdByName: cleanUserName,
      },
      shareUrl: `${frontendUrl}/room/${roomId}`,
    });
  } catch (error) {
    console.error("Create room error:", error);

    return res.status(500).json({
      message: "Failed to create room",
    });
  }
}

async function getRoom(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.name, r.createdByName,
              COALESCE(s.code, 'console.log("Hello, world!");') AS code,
              s.updatedAt
       FROM Room AS r
       LEFT JOIN RoomState AS s ON s.roomId = r.id
       WHERE r.id = ?
       LIMIT 1`,
      [req.params.roomId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.json({ room: rows[0] });
  } catch (error) {
    console.error("Get room error:", error);
    return res.status(500).json({ message: "Failed to load room" });
  }
}

async function joinRoom(req, res) {
  try {
    const userName = req.body.userName;
    const { roomId } = req.params;

    if (typeof userName !== "string" || !userName.trim()) {
      return res.status(400).json({ message: "userName is required" });
    }

    const cleanUserName = userName.trim();
    if (cleanUserName.length > 100) {
      return res.status(400).json({
        message: "Names must be 100 characters or fewer",
      });
    }

    const [rooms] = await pool.execute(
      "SELECT id FROM Room WHERE id = ? LIMIT 1",
      [roomId]
    );

    if (rooms.length === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    await pool.execute(
      `INSERT INTO RoomParticipant (id, userName, roomId)
       VALUES (?, ?, ?)`,
      [randomUUID(), cleanUserName, roomId]
    );

    return res.status(201).json({
      message: "Joined room successfully",
      userName: cleanUserName,
    });
  } catch (error) {
    console.error("Join room error:", error);
    return res.status(500).json({ message: "Failed to join room" });
  }
}

async function saveRoomState(req, res) {
  try {
    const { roomId } = req.params;
    const { code } = req.body;

    if (typeof code !== "string") {
      return res.status(400).json({ message: "code must be a string" });
    }

    if (Buffer.byteLength(code, "utf8") > 1_000_000) {
      return res.status(413).json({ message: "Code exceeds the 1 MB limit" });
    }

    const [rooms] = await pool.execute(
      "SELECT id FROM Room WHERE id = ? LIMIT 1",
      [roomId]
    );

    if (rooms.length === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    await pool.execute(
      `INSERT INTO RoomState (roomId, code)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE code = VALUES(code)`,
      [roomId, code]
    );

    return res.json({ message: "Room code saved" });
  } catch (error) {
    console.error("Save room state error:", error);
    return res.status(500).json({ message: "Failed to save room code" });
  }
}

export { createRoom, getRoom, joinRoom, saveRoomState };
