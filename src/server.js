import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import app from "./app.js";
import pool from "./config/db.js";
import { attachRoomSockets } from "./socket.js";

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = new Server(httpServer);

attachRoomSockets(io, pool);

async function startServer() {
  try {
    // Verify that MySQL is reachable
    await pool.query("SELECT 1");

    httpServer.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to connect to MySQL:", error.message);
    process.exit(1);
  }
}

startServer();
