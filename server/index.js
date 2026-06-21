import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const TICK_RATE = 60;
const ATTACK_RADIUS = 120;

// -------------------- WORLD STATE --------------------

const WORLD = {
  players: new Map(),
  attacks: new Map(),
};

function createPlayer(id) {
  return {
    id,
    x: 1500,
    y: 1500,
    dx: 0,
    dy: 0,
    shield: false,
    shark: false,
  };
}

// -------------------- CONNECTIONS --------------------

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  WORLD.players.set(socket.id, createPlayer(socket.id));

  // movement input
  socket.on("input", (data) => {
    const p = WORLD.players.get(socket.id);
    if (!p) return;

    p.dx = data.dx;
    p.dy = data.dy;
  });

  socket.on("attack", (data) => {
    const p = WORLD.players.get(socket.id);
    if (!p) return;

    const attack = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      attackerId: socket.id,
      x: p.x,
      y: p.y,
      angle: data.angle, // radians
      timestamp: Date.now(),
    };

    WORLD.attacks.set(attack.id, attack);

    // broadcast instantly
    io.emit("attack", attack);
  });

  socket.on("shield", (data) => {
    const p = WORLD.players.get(socket.id);
    if (!p) return;

    p.shield = !!data.shield;
  });

  socket.on("disconnect", () => {
    WORLD.players.delete(socket.id);
  });
});

// -------------------- GAME LOOP --------------------

setInterval(() => {
  const dt = 1 / TICK_RATE;
  const SPEED = 3000;

  // update players
  for (const p of WORLD.players.values()) {
    const len = Math.hypot(p.dx, p.dy) || 1;

    const nx = p.dx / len;
    const ny = p.dy / len;

    p.x += nx * SPEED * dt;
    p.y += ny * SPEED * dt;
  }

  for (const atk of WORLD.attacks.values()) {
    for (const p of WORLD.players.values()) {
      if (!p.alive) continue;
      if (p.id === atk.attackerId) continue;

      const dx = p.x - atk.x;
      const dy = p.y - atk.y;
      const dist = Math.hypot(dx, dy);

      if (dist < ATTACK_RADIUS) {
        if (!p.shield) {
          // 👇 placeholder "kill"
          p.alive = false;
        }
      }
    }
  }

  for (const p of WORLD.players.values()) {
    if (!p.alive) continue;

    // cleanup old attacks (optional but IMPORTANT)
    const now = Date.now();
    for (const [id, atk] of WORLD.attacks) {
      if (now - atk.timestamp > 1000) {
        WORLD.attacks.delete(id);
      }
    }

    // broadcast world state
    io.emit("state", {
      players: Array.from(WORLD.players.values()),
      attacks: Array.from(WORLD.attacks.values()),
    });
  }
}, 1000 / TICK_RATE);

// -------------------- START --------------------

server.listen(3001, () => {
  console.log("server running on :3001");
});

