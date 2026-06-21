import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const TICK_RATE = 60;

// ===== WORLD SCALE (pure units, no pixels here) =====
const SPEED = 3000;              // units per second
const ATTACK_RANGE = 4000;       // units
const ATTACK_ANGLE = Math.PI / 6;

const WORLD = {
    players: new Map(),
};

function createPlayer(id) {
    return {
        id,
        x: 0,
        y: 0,

        dx: 0,
        dy: 0,
        angle: 0,

        // random
        shark: Math.random() < 0.5,

        shield: false,
        attackRequested: false,
        alive: true,
        respawnTimer: 0,
    };
}

function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
}

// INPUT
io.on("connection", (socket) => {
    WORLD.players.set(socket.id, createPlayer(socket.id));

    socket.on("input", (data) => {
        const p = WORLD.players.get(socket.id);
        if (!p) return;

        p.dx = data.dx;
        p.dy = data.dy;

        const len = Math.hypot(data.dx, data.dy);
        if (len > 0.01) {
            p.angle = Math.atan2(data.dy, data.dx);
        }
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

    socket.on("disconnect", () => {
        WORLD.players.delete(socket.id);
    });
});

// GAME LOOP
setInterval(() => {
    const dt = 1 / TICK_RATE;

    // movement
    for (const p of WORLD.players.values()) {
        if (!p.alive) {
            p.respawnTimer -= dt;
            if (p.respawnTimer <= 0) {
                p.alive = true;
                p.x = 0;
                p.y = 0;
            }
            continue;
        }

        const len = Math.hypot(p.dx, p.dy);
        if (len > 0.01) {
            const nx = p.dx / len;
            const ny = p.dy / len;

            p.x += nx * SPEED * dt;
            p.y += ny * SPEED * dt;
        }
    }

    // combat
    for (const attacker of WORLD.players.values()) {
        if (!attacker.attackRequested || !attacker.alive) continue;

        attacker.attackRequested = false;

        // FX event (pure world units)
        io.emit("attack_fx", {
            x: attacker.x,
            y: attacker.y,
            angle: attacker.angle,
        });

        for (const victim of WORLD.players.values()) {
            if (victim === attacker) continue;
            if (!victim.alive) continue;
            if (victim.shield) continue;
            if (attacker.shark == victim.shark) continue; // same type can't hurt each other

            const dx = victim.x - attacker.x;
            const dy = victim.y - attacker.y;

            const dist = Math.hypot(dx, dy);
            if (dist > ATTACK_RANGE) continue;

            const targetAngle = Math.atan2(dy, dx);
            const diff = angleDiff(attacker.angle, targetAngle);

            if (diff <= ATTACK_ANGLE / 2) {
                victim.alive = false;
                victim.respawnTimer = 0;
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