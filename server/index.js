/**
 * =============================================================================
 *  server/index.js
 * -----------------------------------------------------------------------------
 *  The authoritative game server. One process, one Socket.io instance, shared
 *  by every /controller (phone) and every /host (display) that connects.
 *
 *  Responsibilities:
 *    - Accept "join" from a controller once it has a name, assign that
 *      player a random spawn position inside the world bounds, and reply
 *      "joined" with their assigned id/position.
 *    - Accept "input" ({ dx, dy }) from joined controllers and store it as
 *      that player's current movement direction.
 *    - Run an authoritative simulation tick that integrates every player's
 *      position from their last reported direction. Clients never move
 *      themselves - they only ever mirror whatever this loop broadcasts.
 *    - Broadcast a "state" snapshot ({ players, attacks }) to everyone
 *      (controllers AND hosts) on a fixed interval.
 *    - Clean up a player's entry on disconnect.
 *
 *  Multi-controller support is "free": every socket gets its own entry in
 *  `players`, keyed by socket.id. There is no special-casing needed for N
 *  controllers - the tick/broadcast loops just iterate whatever is in the
 *  map at the time.
 *
 *  Run with:  node server/index.js
 *  (requires "socket.io" - npm install socket.io)
 * =============================================================================
 */

const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;

// Keep these in sync with app/controller/page.tsx and app/host/page.tsx.
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const PLAYER_SIZE = 100;
const PLAYER_SPEED = 1000; // world units/sec, applied to the unit-length (dx, dy) a controller sends

const MAX_NAME_LENGTH = 20; // must match MAX_NAME_LENGTH in app/controller/page.tsx

const SIMULATION_TICK_MS = 1000 / 30; // 30 ticks/sec authoritative movement integration
const STATE_BROADCAST_MS = 100; // matches BROADCAST_INTERVAL_MS on the controller

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", // TODO: DEPLOY - restrict this to your actual host/controller origins in production
    methods: ["GET", "POST"],
    // Needed so the browser's CORS preflight allows the
    // ngrok-skip-browser-warning header sent by the clients below.
    allowedHeaders: ["ngrok-skip-browser-warning", "content-type"],
  },
});

/**
 * @typedef {Object} Player
 * @property {string} id      - socket.id; doubles as this player's unique identity
 * @property {string} name    - display name chosen on /controller
 * @property {number} x
 * @property {number} y
 * @property {number} dx      - last reported horizontal input, range [-1, 1]
 * @property {number} dy      - last reported vertical input, range [-1, 1]
 */

/** @type {Record<string, Player>} keyed by socket.id */
const players = {};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Picks a random spawn point, kept far enough from the world edge that a
 * full-size player sprite never spawns clipped off-screen. */
function randomSpawnPosition() {
  const margin = PLAYER_SIZE;
  return {
    x: margin + Math.random() * (WORLD_WIDTH - margin * 2),
    y: margin + Math.random() * (WORLD_HEIGHT - margin * 2),
  };
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // A connected socket is NOT a player yet - it only becomes one once the
  // controller submits a name. Until then it has no entry in `players`, so
  // it's invisible to /host and any "input" it sends is ignored below.
  socket.on("join", (payload) => {
    const rawName = typeof payload?.name === "string" ? payload.name : "";
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);

    if (!name) {
      socket.emit("join-error", { message: "A name is required." });
      return;
    }

    if (players[socket.id]) {
      // Duplicate "join" from the same socket (e.g. a double-submit) -
      // re-confirm rather than re-rolling their spawn.
      const existing = players[socket.id];
      socket.emit("joined", { id: existing.id, name: existing.name, x: existing.x, y: existing.y });
      return;
    }

    const { x, y } = randomSpawnPosition();
    players[socket.id] = { id: socket.id, name, x, y, dx: 0, dy: 0 };

    console.log(`[join] ${socket.id} -> "${name}" at (${x.toFixed(0)}, ${y.toFixed(0)})`);

    socket.emit("joined", { id: socket.id, name, x, y });
  });

  socket.on("input", (payload) => {
    const player = players[socket.id];
    if (!player) return; // not joined yet - nothing to move

    const dx = typeof payload?.dx === "number" ? clamp(payload.dx, -1, 1) : 0;
    const dy = typeof payload?.dy === "number" ? clamp(payload.dy, -1, 1) : 0;
    player.dx = dx;
    player.dy = dy;
  });

  // TODO: GAMEPLAY - no "shield" / "attack" handlers yet. The controller
  // already detects these gestures locally (see gyroAndAccelHandler in
  // app/controller/page.tsx) but doesn't emit them. To wire this up:
  //   socket.on("shield", (payload) => { ... });
  //   socket.on("attack", (payload) => { ... push into an `attacks` array ... });

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    delete players[socket.id];
  });
});

/* -----------------------------------------------------------------------------
 * Authoritative simulation tick
 * -----------------------------------------------------------------------------
 * Server owns position. Every tick, each joined player's position is
 * integrated from their last reported (dx, dy) direction and clamped to the
 * world bounds. Controllers never move themselves locally; /host and
 * /controller both just render whatever "state" broadcasts below.
 * -------------------------------------------------------------------------- */
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const player of Object.values(players)) {
    player.x = clamp(player.x + player.dx * PLAYER_SPEED * dt, 0, WORLD_WIDTH);
    player.y = clamp(player.y + player.dy * PLAYER_SPEED * dt, 0, WORLD_HEIGHT);
  }
}, SIMULATION_TICK_MS);

/* -----------------------------------------------------------------------------
 * Broadcast loop
 * -----------------------------------------------------------------------------
 * Separate from the simulation tick so simulation rate and broadcast rate
 * can be tuned independently (e.g. simulate at 30Hz, broadcast at 10Hz to
 * save bandwidth, as configured here by default).
 * -------------------------------------------------------------------------- */
setInterval(() => {
  io.emit("state", {
    players: Object.values(players),
    attacks: [], // TODO: GAMEPLAY - populate once "attack" is wired up above; /host
                 // already reads this array and is safe with it empty.
  });
}, STATE_BROADCAST_MS);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Game server listening on http://localhost:${PORT}`);
});