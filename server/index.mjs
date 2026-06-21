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

const ATTACK_RADIUS = 40000; // hitbox radius for simplicity

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

  return {
    id,
    name,
    // x: (WORLD_W / 4 + (Math.random() - 0.5) * 2000) + ((WORLD_W * 3) / 4 + (Math.random() - 0.5) * 2000),
    // y: (WORLD_H / 4 + (Math.random() - 0.5) * 2000) + ((WORLD_H * 3) / 4 + (Math.random() - 0.5) * 2000),
    x: 100,
    y: 100,
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

    p.dx = data?.dx ?? 0;
    p.dy = data?.dy ?? 0;

    const len = Math.hypot(p.dx, p.dy);
    if (len > 0.01) {
      p.angle = Math.atan2(p.dy, p.dx);
    }
  });

  channel.on("attack", (data) => {
    const p = WORLD.players.get(channel.id);
    if (!p || !p.alive) return;
    p.attackRequested = true;
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

  const players = Array.from(WORLD.players.values());

  const deaths = [];

  // 1. MOVEMENT
  for (const p of players) {
    if (p.alive) {
      const len = Math.hypot(p.dx, p.dy) || 1;
      p.x += (p.dx / len) * SPEED * dt;
      p.y += (p.dy / len) * SPEED * dt;
    } else {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        deaths.push(p); // respawn queue
      }
    }
  }

  // 2. COMBAT
  for (const attacker of players) {
    if (!attacker.attackRequested || !attacker.alive) continue;
    attacker.attackRequested = false;

    io.emit("attack_fx", {
      x: attacker.x,
      y: attacker.y,
      angle: attacker.angle,
    });

    for (const victim of players) {
      if (victim === attacker || !victim.alive || victim.shield) continue;

      const dx = victim.x - attacker.x;
      const dy = victim.y - attacker.y;

      const forward =
        dx * Math.cos(attacker.angle) +
        dy * Math.sin(attacker.angle);

      const side =
        -dx * Math.sin(attacker.angle) +
        dy * Math.cos(attacker.angle);

      if (
        forward >= 0 &&
        forward <= ATTACK_LENGTH &&
        Math.abs(side) <= ATTACK_WIDTH / 2
      ) {
        victim.alive = false;
        victim.respawnTimer = RESPAWN_TIME;

        attacker.gold += victim.gold;
        victim.gold = 0;
      }
    }
  }

  // 3. RESPAWN CLEANUP
  for (const p of players) {
    if (!p.alive && p.respawnTimer <= 0) {
      p.alive = true;
      p.x = 100;
      p.y = 100;
    }
  }

  // 4. EMIT
  io.emit("state", {
    players: Array.from(WORLD.players.values()),
    teams: WORLD.teams,
  });

}, 1000 / TICK_RATE);

// -------------------- START --------------------

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`server running on :${PORT}`);
});

