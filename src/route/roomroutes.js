
import express from "express";
import {
  createRoom,
  getRoom,
  joinRoom,
  saveRoomState,
} from "../controller/roomcontroller.js";

const router = express.Router();

router.post("/", createRoom);
router.get("/:roomId", getRoom);
router.post("/:roomId/join", joinRoom);
router.put("/:roomId/state", saveRoomState);

export default router;
