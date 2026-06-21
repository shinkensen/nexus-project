"use client";

import { useEffect, useRef } from "react";
import { supabase } from "../backend/supabase";
import { setPosition, setShield } from "../backend/funcs";

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000;

const ATTACK_COOLDOWN_TIME = 4;
const SHIELD_COOLDOWN_TIME = 3;

const GAMMA_THRESHOLD = 5;
const Y_THRESHOLD = 6;
const SHIELD_DURATION = 3000;

const BROADCAST_INTERVAL_MS = 100;
const GRID_SIZE = 100;

type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

type Player = {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  shield: boolean;
  lastUpdate: number;
};

type TouchState = {
  active: boolean;
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
};

export default function Game({
  playerName,
  orientation,
  motion,
}: {
  playerName: string;
  orientation?: Orientation;
  motion?: Motion;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep latest sensor data without re-running the whole game effect
  const sensorRef = useRef<{ orientation?: Orientation; motion?: Motion }>({
    orientation,
    motion,
  });

  useEffect(() => {
    sensorRef.current = { orientation, motion };
  }, [orientation, motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // =========================
    // Canvas / viewport
    // =========================
    let width = 0;
    let height = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    resize();
    window.addEventListener("resize", resize);
    canvas.style.touchAction = "none";

    // =========================
    // Identity / player refs
    // =========================
    const selfId =
      localStorage.getItem("player_uuid") ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2));

    localStorage.setItem("player_uuid", selfId);

    const localPlayer: Player = {
      id: selfId,
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      dx: 0,
      dy: 0,
      shield: false,
      lastUpdate: performance.now(),
    };

    const remotePlayers: Record<string, Player> = {};

    // =========================
    // Input state
    // =========================
    const keys: Record<string, boolean> = {};
    const touch: TouchState = {
      active: false,
      pointerId: -1,
      originX: 0,
      originY: 0,
      x: 0,
      y: 0,
    };

    const maxTouchDistance = 90;
    const touchDeadzone = 8;

    // =========================
    // Timers / cooldowns
    // =========================
    let rafId = 0;
    let lastFrame = performance.now();
    let lastBroadcast = 0;

    let attackCooldown = 0;
    let shieldCooldown = 0;

    let shieldTimeout: ReturnType<typeof setTimeout> | null = null;

    let prevGamma: number | null = null;
    let prevMotionY: number | null = null;

    // =========================
    // Helpers
    // =========================
    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));

    const normalize = (x: number, y: number) => {
      const len = Math.hypot(x, y);
      if (len === 0) return { x: 0, y: 0 };
      return { x: x / len, y: y / len };
    };

    const getCamera = () => {
      const cameraX = clamp(localPlayer.x - width / 2, 0, WORLD_WIDTH - width);
      const cameraY = clamp(localPlayer.y - height / 2, 0, WORLD_HEIGHT - height);
      return { cameraX, cameraY };
    };

    const triggerShield = async () => {
      if (shieldCooldown > 0) return;

      localPlayer.shield = true;
      shieldCooldown = SHIELD_COOLDOWN_TIME;

      try {
        await setShield(selfId, true);
      } catch (err) {
        console.error("Failed to enable shield:", err);
      }

      if (shieldTimeout) clearTimeout(shieldTimeout);
      shieldTimeout = setTimeout(async () => {
        localPlayer.shield = false;
        try {
          await setShield(selfId, false);
        } catch (err) {
          console.error("Failed to disable shield:", err);
        }
        shieldTimeout = null;
      }, SHIELD_DURATION);
    };

    // =========================
    // Sensor / motion shield detection
    // =========================
    const updateShieldFromSensors = () => {
      const { orientation, motion } = sensorRef.current;
      if (!orientation || !motion) return;

      if (prevGamma !== null && prevMotionY !== null) {
        const gammaDelta = Math.abs(orientation.gamma - prevGamma);
        const accelYDelta = Math.abs(motion.y - prevMotionY);

        if (gammaDelta > GAMMA_THRESHOLD && accelYDelta > Y_THRESHOLD) {
          void triggerShield();
        }
      }

      prevGamma = orientation.gamma;
      prevMotionY = motion.y;
    };

    // =========================
    // Input handling
    // =========================
    const onKeyDown = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || touch.active) return;

      touch.active = true;
      touch.pointerId = e.pointerId;
      touch.originX = e.clientX;
      touch.originY = e.clientY;
      touch.x = e.clientX;
      touch.y = e.clientY;

      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!touch.active || e.pointerId !== touch.pointerId) return;
      touch.x = e.clientX;
      touch.y = e.clientY;
    };

    const endTouch = (e: PointerEvent) => {
      if (e.pointerId !== touch.pointerId) return;

      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }

      touch.active = false;
      touch.pointerId = -1;
    };

    const getMovementInput = () => {
      let dx = 0;
      let dy = 0;

      // Keyboard
      if (keys["w"] || keys["arrowup"]) dy -= 1;
      if (keys["s"] || keys["arrowdown"]) dy += 1;
      if (keys["a"] || keys["arrowleft"]) dx -= 1;
      if (keys["d"] || keys["arrowright"]) dx += 1;

      // Touch joystick (adds / overrides direction)
      if (touch.active) {
        const rawDx = touch.x - touch.originX;
        const rawDy = touch.y - touch.originY;
        const dist = Math.hypot(rawDx, rawDy);

        if (dist > touchDeadzone) {
          const strength = Math.min(
            1,
            (dist - touchDeadzone) / (maxTouchDistance - touchDeadzone)
          );

          dx += (rawDx / dist) * strength;
          dy += (rawDy / dist) * strength;
        }
      }

      return normalize(dx, dy);
    };

    // =========================
    // Networking
    // =========================
    const channel = supabase
      .channel("game_room")
      .on("broadcast", { event: "joystick" }, (payload) => {
        const { uuid, dx, dy } = payload.payload as {
          uuid: string;
          dx: number;
          dy: number;
        };

        if (!uuid || uuid === selfId) return;

        if (!remotePlayers[uuid]) {
          remotePlayers[uuid] = {
            id: uuid,
            x: WORLD_WIDTH / 2,
            y: WORLD_HEIGHT / 2,
            dx: 0,
            dy: 0,
            shield: false,
            lastUpdate: performance.now(),
          };
        }

        remotePlayers[uuid].dx = dx;
        remotePlayers[uuid].dy = dy;
        remotePlayers[uuid].lastUpdate = performance.now();
      })
      .subscribe();

    // =========================
    // Drawing
    // =========================
    const drawGrid = (cameraX: number, cameraY: number) => {
      ctx.strokeStyle = "#2b2b2b";
      ctx.lineWidth = 1;

      const startX = Math.floor(cameraX / GRID_SIZE) * GRID_SIZE;
      const endX = cameraX + width;
      for (let x = startX; x <= endX; x += GRID_SIZE) {
        const screenX = x - cameraX;
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, height);
        ctx.stroke();
      }

      const startY = Math.floor(cameraY / GRID_SIZE) * GRID_SIZE;
      const endY = cameraY + height;
      for (let y = startY; y <= endY; y += GRID_SIZE) {
        const screenY = y - cameraY;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(width, screenY);
        ctx.stroke();
      }
    };

    const drawWorldBounds = (cameraX: number, cameraY: number) => {
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 3;
      ctx.strokeRect(-cameraX, -cameraY, WORLD_WIDTH, WORLD_HEIGHT);
    };

    const drawPlayer = (
      player: Player,
      cameraX: number,
      cameraY: number,
      color: string,
      label: string
    ) => {
      const screenX = player.x - cameraX;
      const screenY = player.y - cameraY;

      // body
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, PLAYER_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      // shield ring
      if (player.shield) {
        ctx.strokeStyle = "#5ec8ff";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(screenX, screenY, PLAYER_SIZE / 2 + 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      // label
      ctx.fillStyle = "#fff";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, screenX, screenY - PLAYER_SIZE / 2 - 12);
    };

    const drawJoystick = () => {
      if (!touch.active) return;

      const rawDx = touch.x - touch.originX;
      const rawDy = touch.y - touch.originY;
      const dist = Math.hypot(rawDx, rawDy);

      let knobX = touch.x;
      let knobY = touch.y;

      if (dist > maxTouchDistance) {
        const scale = maxTouchDistance / dist;
        knobX = touch.originX + rawDx * scale;
        knobY = touch.originY + rawDy * scale;
      }

      // base
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(touch.originX, touch.originY, maxTouchDistance, 0, Math.PI * 2);
      ctx.fill();

      // knob
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "#7aa2ff";
      ctx.beginPath();
      ctx.arc(knobX, knobY, 35, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    };

    // =========================
    // Main loop
    // =========================
    const loop = (now: number) => {
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;

      attackCooldown = Math.max(0, attackCooldown - dt);
      shieldCooldown = Math.max(0, shieldCooldown - dt);

      // Read input
      const input = getMovementInput();
      localPlayer.dx = input.x;
      localPlayer.dy = input.y;

      // Move local player
      localPlayer.x = clamp(
        localPlayer.x + localPlayer.dx * PLAYER_SPEED * dt,
        PLAYER_SIZE / 2,
        WORLD_WIDTH - PLAYER_SIZE / 2
      );
      localPlayer.y = clamp(
        localPlayer.y + localPlayer.dy * PLAYER_SPEED * dt,
        PLAYER_SIZE / 2,
        WORLD_HEIGHT - PLAYER_SIZE / 2
      );

      // Simulate remote players based on latest received direction
      for (const id in remotePlayers) {
        const p = remotePlayers[id];
        p.x = clamp(
          p.x + p.dx * PLAYER_SPEED * dt,
          PLAYER_SIZE / 2,
          WORLD_WIDTH - PLAYER_SIZE / 2
        );
        p.y = clamp(
          p.y + p.dy * PLAYER_SPEED * dt,
          PLAYER_SIZE / 2,
          WORLD_HEIGHT - PLAYER_SIZE / 2
        );
      }

      // Throttled backend update
      if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
        lastBroadcast = now;
        void setPosition(selfId, { x: localPlayer.dx, y: localPlayer.dy });
      }

      // Shield detection from sensors
      updateShieldFromSensors();

      // Camera follows local player
      const { cameraX, cameraY } = getCamera();

      // Clear
      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, width, height);

      // Draw world
      drawGrid(cameraX, cameraY);
      drawWorldBounds(cameraX, cameraY);

      // Draw remote players
      for (const id in remotePlayers) {
        drawPlayer(remotePlayers[id], cameraX, cameraY, "#ff6b6b", id.slice(0, 4));
      }

      // Draw local player
      drawPlayer(localPlayer, cameraX, cameraY, "#4ade80", playerName || "You");

      // UI
      drawJoystick();

      rafId = requestAnimationFrame(loop);
    };

    // =========================
    // Event listeners
    // =========================
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endTouch);
    canvas.addEventListener("pointercancel", endTouch);

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endTouch);
      canvas.removeEventListener("pointercancel", endTouch);

      if (shieldTimeout) clearTimeout(shieldTimeout);
      supabase.removeChannel(channel);
    };
  }, [playerName]);

  return (
    <canvas
      ref={canvasRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: "100vw",
        height: "100vh",
        display: "block",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    />
  );
}