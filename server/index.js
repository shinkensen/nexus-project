import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const TICK_RATE = 20; // 20 updates/sec

const WORLD = {
  players: new Map(),
};

function createPlayer(id) {
  return {
    id,
    x: 1500,
    y: 1500,
    dx: 0,
    dy: 0,
  };
}

// INPUT from controllers
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  WORLD.players.set(socket.id, createPlayer(socket.id));

  socket.on("input", (data) => {
    const p = WORLD.players.get(socket.id);
    if (!p) return;

    p.dx = data.dx;
    p.dy = data.dy;
  });

  socket.on("disconnect", () => {
    WORLD.players.delete(socket.id);
  });
});

// GAME LOOP
setInterval(() => {
  const dt = 1 / TICK_RATE;
  const SPEED = 300;

  for (const p of WORLD.players.values()) {
    const len = Math.hypot(p.dx, p.dy) || 1;

    const nx = p.dx / len;
    const ny = p.dy / len;

    p.x += nx * SPEED * dt;
    p.y += ny * SPEED * dt;
  }

  io.emit("state", {
    players: Array.from(WORLD.players.values()),
  });
}, 1000 / TICK_RATE);

server.listen(3001, () => {
  console.log("server running on :3001");
});