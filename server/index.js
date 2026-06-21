import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const TICK_RATE = 60;
const ATTACK_RANGE = 400;
const ATTACK_ANGLE = Math.PI / 3; // 60°

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

    facingX: 1,
    facingY: 0,

    shield: false,
    attackRequested: false,
    alive: true,

    respawnTimer: 0,
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

  socket.on("attack", () => {
    const p = WORLD.players.get(socket.id);
    if (!p || !p.alive) return;

    p.attackRequested = true;
  });

  socket.on("shield", (enabled) => {
    const p = WORLD.players.get(socket.id);
    if (!p || !p.alive) return;

    p.shield = enabled;
  });
});

// GAME LOOP
setInterval(() => {
  const dt = 1 / TICK_RATE;
  const SPEED = 3000;

  for (const p of WORLD.players.values()) {
    if (!p.alive) {
      p.respawnTimer -= dt;

      if (p.respawnTimer <= 0) {
        p.alive = true;
        p.x = 1500;
        p.y = 1500;
      }

      continue;
    }

    const len = Math.hypot(p.dx, p.dy) || 1;

    const nx = p.dx / len;
    const ny = p.dy / len;

    p.x += nx * SPEED * dt;
    p.y += ny * SPEED * dt;
  }

  for (const attacker of WORLD.players.values()) {
    if (!attacker.attackRequested || !attacker.alive)
      continue;

    attacker.attackRequested = false;

    for (const victim of WORLD.players.values()) {
      if (victim === attacker) continue;
      if (!victim.alive) continue;
      if (victim.shield) continue;

      const vx = victim.x - attacker.x;
      const vy = victim.y - attacker.y;

      const dist = Math.hypot(vx, vy);

      if (dist > ATTACK_RANGE)
        continue;

      const dirX = vx / dist;
      const dirY = vy / dist;

      const dot =
        dirX * attacker.facingX +
        dirY * attacker.facingY;

      const angle = Math.acos(
        Math.max(-1, Math.min(1, dot))
      );

      if (angle <= ATTACK_ANGLE / 2) {
        victim.alive = false;
        victim.respawnTimer = 2; // seconds
      }
    }
  }

  io.emit("state", {
    players: Array.from(WORLD.players.values()),
  });
}, 1000 / TICK_RATE);

server.listen(3001, () => {
  console.log("server running on :3001");
});