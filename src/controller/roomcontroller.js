
import { randomUUID } from "node:crypto";
import pool from "../config/db.js";

const STARTER_CODE = `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}`;

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
        [roomId, STARTER_CODE]
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
              COALESCE(s.code, ?) AS code,
              COALESCE(s.version, 0) AS version,
              s.updatedAt
       FROM Room AS r
       LEFT JOIN RoomState AS s ON s.roomId = r.id
       WHERE r.id = ?
       LIMIT 1`,
      [STARTER_CODE, req.params.roomId]
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

export { createRoom, getRoom, joinRoom };
