import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { config } from "./config";
import { openDb } from "./db/db";
import { registerAuth } from "./auth/index";
import { registerRoom } from "./room/handlers";
import { registerBlink } from "./chain/blink";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
// origin:true reflects the request origin — fine for local dev across the Vite port.
const io = new Server(server, { cors: { origin: true } });

const db = openDb();

// Auth first: installs the handshake middleware so socket.data.user is set before
// the room's connection handler runs, and mounts the /api identity endpoints.
registerAuth(io, app, db);
// After registerAuth: reuses the CORS + express.json() middleware it installs.
registerBlink(app);
registerRoom(io);

server.listen(config.port, () => {
  console.log(`bitopia server listening on :${config.port}`);
});
