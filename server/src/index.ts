import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { config } from "./config";
import { registerRoom } from "./room/handlers";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
// origin:true reflects the request origin — fine for local dev across the Vite port.
const io = new Server(server, { cors: { origin: true } });

registerRoom(io);

server.listen(config.port, () => {
  console.log(`bitopia server listening on :${config.port}`);
});
