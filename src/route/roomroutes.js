
import express from "express";
import { createRoom } from "../controller/roomcontroller.js"; // Don't forget the .js extension!

const router = express.Router();

router.post("/", createRoom);

export default router;
