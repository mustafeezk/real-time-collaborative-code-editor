
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
      process.env.FRONTEND_URL ||
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

export { createRoom };
