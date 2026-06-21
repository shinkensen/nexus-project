import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const TICK_RATE = 60;

// ===== WORLD SCALE =====
const SPEED = 4000;
const ATTACK_RANGE = 4000;
const ATTACK_ANGLE = Math.PI / 6;

// ===== MAP =====
const MAP = {
    width: 20000,
    height: 10000,
};

const WORLD = {
    players: new Map(),
};

function getTeamCounts() {
    let sharks = 0;
    let cats = 0;

    for (const p of WORLD.players.values()) {
        if (p.shark) sharks++;
        else cats++;
    }

    return { sharks, cats };
}

function assignTeam() {
    const { sharks, cats } = getTeamCounts();

    // self-balancing rule
    if (sharks <= cats) return true;  // shark
    return false; // cat
}

function spawnPosition(isShark) {
    if (isShark) {
        return {
            x: MAP.width * 0.1, // left side
            y: Math.random() * MAP.height,
        };
    } else {
        return {
            x: MAP.width * 0.9, // right side
            y: Math.random() * MAP.height,
        };
    }
}

function createPlayer(id) {
    const shark = assignTeam();
    const pos = spawnPosition(shark);

    return {
        id,

        x: pos.x,
        y: pos.y,

        dx: 0,
        dy: 0,
        angle: 0,

        shark,

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

// ===== INPUT =====
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

// ===== GAME LOOP =====
setInterval(() => {
    const dt = 1 / TICK_RATE;

    // movement + respawn
    for (const p of WORLD.players.values()) {
        if (!p.alive) {
            p.respawnTimer -= dt;

            if (p.respawnTimer <= 0) {
                p.alive = true;

                const pos = spawnPosition(p.shark);
                p.x = pos.x;
                p.y = pos.y;

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

            if (p.x < 0) p.x = 0;
            if (p.x > 20000) p.x = 20000;
            if (p.y < 0) p.y = 0;
            if (p.y > 10000) p.y = 10000;
        }
    }

    // combat
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

            // team rule
            if (attacker.shark === victim.shark) continue;

            const dx = victim.x - attacker.x;
            const dy = victim.y - attacker.y;

            const dist = Math.hypot(dx, dy);
            if (dist > ATTACK_RANGE) continue;

            const targetAngle = Math.atan2(dy, dx);
            const diff = angleDiff(attacker.angle, targetAngle);

            if (diff <= ATTACK_ANGLE / 2) {
                victim.alive = false;
                victim.respawnTimer = 2;
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