import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import roomRoutes from "./route/roomroutes.js";

const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(currentDir, "../dist");

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/rooms", roomRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.use(express.static(distPath));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

export default app;
