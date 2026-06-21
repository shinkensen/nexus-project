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
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  portRange: {
    min: 10000,
    max: 10100,
  },
});
io.addServer(server);

// Friendly root route
app.get("/", (req, res) => {
  res.send("Game server is running successfully!");
});

// ─── Constants ────────────────────────────────────────────────────────────────

const TICK_RATE = 60;
const SPEED = 3000;
const ATTACK_LENGTH = 4000; // forward distance
const ATTACK_WIDTH = 1200;  // total width
const RESPAWN_TIME = 3;
const WORLD_W = 17000;
const WORLD_H = 8000;

// ─── World state ──────────────────────────────────────────────────────────────

const WORLD = {
  players: new Map(),

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
  let shark = 0, cat = 0;
  for (const p of WORLD.players.values()) {
    if (p.shark) {
      shark++;
    }
    else {
      cat++;
    }
  }

  WORLD.teams.shark.gold += 200;
  WORLD.teams.cat.gold += 200;

  ranX = (WORLD_W / 4 + (Math.random() - 0.5) * 2000) + ((WORLD_W * 3) / 4 + (Math.random() - 0.5) * 2000);
  ranY = (WORLD_H / 4 + (Math.random() - 0.5) * 2000) + ((WORLD_H * 3) / 4 + (Math.random() - 0.5) * 2000);

  return {
    id,
    name,
    x: ranX,
    y: ranY,
    dx: 0,
    dy: 0,
    angle: 0,
    shark: shark < cat ? true : false,
    shield: false,
    attackRequested: false,
    alive: true,
    respawnTimer: 0,
    gold: 0,
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

// ─── Connections ──────────────────────────────────────────────────────────────

io.onConnection((channel) => {
  console.log(`[SERVER LOG] New connection. ID: ${channel.id}`);

  channel.on("join", (data) => {
    const name = data?.name || "Anonymous";
    console.log(`[SERVER LOG] Join: ${channel.id} as "${name}"`);
    WORLD.players.set(channel.id, createPlayer(channel.id, name));
    console.log(`[SERVER LOG] Active players: ${WORLD.players.size}`);
  });

  channel.on("input", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p) return;

    p.dx = data?.dx ?? 0;
    p.dy = data?.dy ?? 0;

    const len = Math.hypot(p.dx, p.dy);
    if (len > 0.01) {
      p.angle = Math.atan2(p.dy, p.dx);
    }
  });

  // Attack — payload is always an object (even if empty {}) so data is never null
  channel.on("attack", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p || !p.alive) return;
    p.attackRequested = true;
  });

  channel.on("shield", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p) return;
    p.shield = !!data?.shield;
  });

  channel.onDisconnect(() => {
    console.log(`[SERVER LOG] Disconnected. ID: ${channel.id}`);
    WORLD.players.delete(channel.id);
    console.log(`[SERVER LOG] Active players: ${WORLD.players.size}`);
  });
});

// ─── Game loop ────────────────────────────────────────────────────────────────

setInterval(() => {
  const dt = 1 / TICK_RATE;

  for (const p of WORLD.players.values()) {
    if (!p.alive) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        p.alive = true;

        if (p.shark) {
          p.x = WORLD_W / 4 + (Math.random() - 0.5) * 2000;
          p.y = WORLD_H / 4 + (Math.random() - 0.5) * 2000;
        } else {
          p.x = (WORLD_W * 3) / 4 + (Math.random() - 0.5) * 2000;
          p.y = (WORLD_H * 3) / 4 + (Math.random() - 0.5) * 2000;
        }

        p.dx = 0;
        p.dy = 0;
      }
      continue;
    }

    const len = Math.hypot(p.dx, p.dy);
    if (len > 0.01) {
      const nx = p.dx / len;
      const ny = p.dy / len;
      p.x += nx * SPEED * dt;
      p.y += ny * SPEED * dt;

      p.x = Math.max(0, Math.min(WORLD_W, p.x));
      p.y = Math.max(0, Math.min(WORLD_H, p.y));
    }

    if (!p.shark && p.x < 2500 && WORLD.teams.shark.gold > 0) {
      p.gold += 1;
      WORLD.teams.shark.gold -= 1;
    } else if (p.shark && p.x > 13000 && WORLD.teams.cat.gold > 0) {
      p.gold += 1;
      WORLD.teams.cat.gold -= 1;
    }

    if (!p.shark && p.x > 13000) {
      WORLD.teams.cat.gold += p.gold;
      p.gold = 0;
    } else if (p.shark && p.x < 2500) {
      WORLD.teams.shark.gold += p.gold;
      p.gold = 0;
    }
  }

  for (const attacker of WORLD.players.values()) {
    if (!attacker.attackRequested || !attacker.alive) continue;

    attacker.attackRequested = false;

    io.emit("attack_fx", {
      x: attacker.x,
      y: attacker.y,
      angle: attacker.angle,
    });

    for (const victim of WORLD.players.values()) {
      if (victim === attacker) continue;
      if (!victim.alive) continue;
      if (victim.shield) continue;
      if (attacker.shark === victim.shark) continue;

      const dx = victim.x - attacker.x;
      const dy = victim.y - attacker.y;

      // Transform victim into attacker's local coordinate system.
      // forward = distance in front of attacker
      // side = distance left/right of attacker
      const forward =
        dx * Math.cos(attacker.angle) +
        dy * Math.sin(attacker.angle);

      const side =
        -dx * Math.sin(attacker.angle) +
        dy * Math.cos(attacker.angle);

      // Rectangle test
      if (
        forward >= 0 &&
        forward <= ATTACK_LENGTH &&
        Math.abs(side) <= ATTACK_WIDTH / 2
      ) {
        victim.alive = false;
        victim.respawnTimer = RESPAWN_TIME;

        attacker.gold += victim.gold;
        victim.gold = 0;

        console.log(`[SERVER LOG] ${attacker.name} eliminated ${victim.name}!`);
      }
    }
  }

  io.emit("state", {
    players: Array.from(WORLD.players.values()),
    teams: WORLD.teams,
  });
}, 1000 / TICK_RATE);

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[SERVER LOG] Server running on :${PORT}`);
});