
import express from "express";
import {
  createRoom,
  getRoom,
  joinRoom,
} from "../controller/roomcontroller.js";

const router = express.Router();

router.post("/", createRoom);
router.get("/:roomId", getRoom);
router.post("/:roomId/join", joinRoom);

export default router;
