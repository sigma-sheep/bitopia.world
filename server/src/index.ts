import http from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

// Serve the built Vite client as static files so a single Railway service hosts
// both the SPA and the API/socket. `start` runs from the repo root, so the build
// output lives at <root>/client/dist; tolerate launch from server/ too. Skipped
// in dev (no dist), where Vite serves the client on its own port.
const clientDist = [resolve(process.cwd(), "client/dist"), resolve(process.cwd(), "../client/dist")].find(existsSync);
if (clientDist) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.get(/^\/(?!api\/|health$|socket\.io\/).*/, (_req, res) => {
    res.sendFile(resolve(clientDist, "index.html"));
  });
}

server.listen(config.port, () => {
  console.log(`bitopia server listening on :${config.port}`);
});
