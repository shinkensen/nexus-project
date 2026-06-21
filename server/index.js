import express from "express";
import http from "http";
import geckos from "@geckos.io/server";

const app = express();
const server = http.createServer(app);
const io = geckos({
  cors: {
    allowAuthorization: true,
    origin: "*",
  },
  address: "165.22.144.193",
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ],
  portRange: {
    min: 10000,
    max: 10100
  }
});
io.addServer(server);

// Friendly root page route
app.get("/", (req, res) => {
  res.send("Game server is running successfully!");
});

const TICK_RATE = 60;
const SPEED = 3000;
const ATTACK_LENGTH = 4000; // forward distance
const ATTACK_WIDTH = 1200;  // total width
const RESPAWN_TIME = 3;
const WORLD_W = 17000;
const WORLD_H = 8000;

// -------------------- WORLD STATE --------------------

const WORLD = {
  players: new Map(),
  attacks: new Map(),

  teams: {
    shark: {
      gold: 0,
    },
    cat: {
      gold: 0,
    }
  }
};

function createPlayer(id, name) {
  return {
    id,
    name,
    x: 1500,
    y: 1500,
    dx: 0,
    dy: 0,
    shield: false,
    shark: false,
    alive: true,
  };
}

// -------------------- CONNECTIONS --------------------

io.onConnection((channel) => {
  console.log(`[SERVER LOG] New channel connection initiated. ID: ${channel.id}`);

  // We add to WORLD players map only when the controller completes name entry and joins
  channel.on("join", (data) => {
    const name = data?.name || "Anonymous";
    console.log(`[SERVER LOG] Join event received from ID: ${channel.id} with name: "${name}"`);
    WORLD.players.set(channel.id, createPlayer(channel.id, name));
    console.log(`[SERVER LOG] Active Players count: ${WORLD.players.size}`);
  });

  // movement input
  channel.on("input", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p) {
      console.log(`[SERVER LOG] Input received from ID: ${channel.id} but player is not in active players list.`);
      return;
    }
    p.dx = data.dx;
    p.dy = data.dy;
  });

  channel.on("attack", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p) return;

    const attack = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      attackerId: channel.id,
      x: p.x,
      y: p.y,
      // angle: data.angle, // radians
      angle: 0,
      timestamp: Date.now(),
    };

    WORLD.attacks.set(attack.id, attack);
    console.log(`[SERVER LOG] Attack registered from player: ${p.name}`);

    // broadcast instantly
    io.emit("attack", attack);
  });

  channel.on("shield", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p) return;

    p.shield = !!data.shield;
  });

  channel.onDisconnect(() => {
    console.log(`[SERVER LOG] Channel disconnected. ID: ${channel.id}`);
    WORLD.players.delete(channel.id);
    console.log(`[SERVER LOG] Active Players count: ${WORLD.players.size}`);
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
  }

  // broadcast world state to all connected channels
  io.emit("state", {
    players: Array.from(WORLD.players.values()),
    attacks: Array.from(WORLD.attacks.values()),
  });
}, 1000 / TICK_RATE);

// -------------------- START --------------------

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`server running on :${PORT}`);
});

