"use client";

import { useEffect, useRef } from "react";

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000; // pixels/sec

const ATTACK_DURATION = 0.15; // seconds
const COOLDOWN_TIME = 0.5; // seconds

// Thresholds for the shake-to-swap-sprite gesture
const GAMMA_DELTA_THRESHOLD = 5;
const ACCEL_Y_DELTA_THRESHOLD = 6;

type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

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

  // keep latest orientation/motion available inside the imperative loop,
  // since the loop closure is created once with an empty effect dep array
  const debugRef = useRef({ orientation, motion });
  useEffect(() => {
    debugRef.current = { orientation, motion };
  }, [orientation, motion]);

  let health = 100;
  let shark = true;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    // Preload sprites once instead of constructing a new Image every frame
    const catImage = new Image();
    catImage.src = "/assets/sprites/cat-removebg-preview.png";

    const sharkImage = new Image();
    sharkImage.src = "/assets/sprites/shark-removebg-preview.png";

    let width = window.innerWidth;
    let height = window.innerHeight;

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = width;
      canvas.height = height;
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.style.touchAction = "none";

    const keys: Record<string, boolean> = {};
    const touchInput = {
      active: false,
      pointerId: -1,
      originX: 0,
      originY: 0,
      x: 0,
      y: 0,
    };

    const localPlayer = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
    };

    const players: Record<string, { x: number, y: number, dx: number, dy: number, lastUpdate: number }> = {};

    const channel = supabase.channel('game_room')
      .on(
        'broadcast',
        { event: 'joystick' },
        (payload) => {
          const { uuid, dx, dy } = payload.payload;
          if (!players[uuid]) {
            players[uuid] = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, dx: 0, dy: 0, lastUpdate: performance.now() };
          }
          players[uuid].dx = dx;
          players[uuid].dy = dy;
          players[uuid].lastUpdate = performance.now();
        }
      )
      .subscribe();

    function keyDown(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = true;
    }

    function keyUp(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = false;
    }

    function updateTouchInput(e: PointerEvent) {
      if (!touchInput.active || e.pointerId !== touchInput.pointerId) {
        return;
      }

      touchInput.x = e.clientX;
      touchInput.y = e.clientY;
    }

    function startTouchInput(e: PointerEvent) {
      if (e.pointerType !== "touch" || touchInput.active) {
        return;
      }

      touchInput.active = true;
      touchInput.pointerId = e.pointerId;
      touchInput.originX = e.clientX;
      touchInput.originY = e.clientY;
      touchInput.x = e.clientX;
      touchInput.y = e.clientY;

      canvas.setPointerCapture(e.pointerId);
    }

    function endTouchInput(e: PointerEvent) {
      if (e.pointerId !== touchInput.pointerId) {
        return;
      }

      canvas.releasePointerCapture(e.pointerId);
      touchInput.active = false;
      touchInput.pointerId = -1;
    }

    function attackPointerDown(e: PointerEvent) {
      if (e.button === 0 && cooldown <= 0) {
        attackTime = ATTACK_DURATION;
        cooldown = COOLDOWN_TIME;
      }
    }

    function updatePointerPosition(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", startTouchInput);
    canvas.addEventListener("pointermove", updateTouchInput);
    canvas.addEventListener("pointerup", endTouchInput);
    canvas.addEventListener("pointercancel", endTouchInput);
    window.addEventListener("pointerdown", attackPointerDown);
    canvas.addEventListener("pointermove", updatePointerPosition);

    const pointer = {
      x: 0,
      y: 0,
    };

    function takeDamage(amount: number) {
      health -= amount;
      if (health < 0) health = 0;
    }

    let last = performance.now();
    const maxTouchDistance = 90;
    const touchDeadzone = 8;

    let attackTime = 0;
    let cooldown = 0;

    // Previous orientation/motion readings, used to detect the shake
    // gesture that swaps the player's sprite.
    let prevGamma: number | null = null;
    let prevMotionX: number | null = null;
    let prevMotionY: number | null = null;
    let prevMotionZ: number | null = null;

    function updateShakeToSwapSprite() {
      const currentOrientation = debugRef.current.orientation;
      const currentMotion = debugRef.current.motion;

      if (!currentOrientation || !currentMotion) return;

      const { gamma } = currentOrientation;
      const { x, y, z } = currentMotion;

      if (prevGamma !== null && prevMotionY !== null) {
        const gammaDelta = Math.abs(gamma - prevGamma);
        const accelYDelta = Math.abs(y - prevMotionY);

        if (
          gammaDelta > GAMMA_DELTA_THRESHOLD &&
          accelYDelta > ACCEL_Y_DELTA_THRESHOLD
        ) {
          shark = !shark;
        }
      }

      prevGamma = gamma;
      prevMotionX = x;
      prevMotionY = y;
      prevMotionZ = z;
    }

    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

      attackTime -= dt;
      cooldown -= dt;

      if (attackTime < 0) attackTime = 0;
      if (cooldown < 0) cooldown = 0;

      let dx = 0;
      let dy = 0;

      if (keys["w"] || keys["arrowup"]) dy--;
      if (keys["s"] || keys["arrowdown"]) dy++;
      if (keys["a"] || keys["arrowleft"]) dx--;
      if (keys["d"] || keys["arrowright"]) dx++;

      if (touchInput.active) {
        const touchDx = touchInput.x - touchInput.originX;
        const touchDy = touchInput.y - touchInput.originY;
        const touchDistance = Math.hypot(touchDx, touchDy);

        if (touchDistance > touchDeadzone) {
          const touchStrength = Math.min(
            1,
            (touchDistance - touchDeadzone) / (maxTouchDistance - touchDeadzone)
          );

          dx += (touchDx / touchDistance) * touchStrength;
          dy += (touchDy / touchDistance) * touchStrength;
        }
      }

      // Normalize diagonal movement
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
      }

      localPlayer.x += dx * PLAYER_SPEED * dt;
      localPlayer.y += dy * PLAYER_SPEED * dt;

      // Keep local player inside world
      localPlayer.x = Math.max(
        PLAYER_SIZE / 2,
        Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, localPlayer.x)
      );
      localPlayer.y = Math.max(
        PLAYER_SIZE / 2,
        Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, localPlayer.y)
      );

      // Update remote players
      for (const uuid in players) {
        const p = players[uuid];
        p.x += p.dx * PLAYER_SPEED * dt;
        p.y += p.dy * PLAYER_SPEED * dt;

        p.x = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, p.x));
        p.y = Math.max(PLAYER_SIZE / 2, Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, p.y));

        if (now - p.lastUpdate > 2000) {
          p.dx = 0;
          p.dy = 0;
        }
      }

      // Camera follows local player
      const cameraX = Math.max(
        0,
        Math.min(WORLD_WIDTH - width, localPlayer.x - width / 2)
      );

      const cameraY = Math.max(
        0,
        Math.min(WORLD_HEIGHT - height, localPlayer.y - height / 2)
      );

      // Background
      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, width, height);

      // Grid
      ctx.strokeStyle = "#2f2f2f";
      ctx.lineWidth = 1;

      const grid = 100;

      const startX = Math.floor(cameraX / grid) * grid;
      const startY = Math.floor(cameraY / grid) * grid;

      for (let x = startX; x <= cameraX + width; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x - cameraX, 0);
        ctx.lineTo(x - cameraX, height);
        ctx.stroke();
      }

      for (let y = startY; y <= cameraY + height; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y - cameraY);
        ctx.lineTo(width, y - cameraY);
        ctx.stroke();
      }

      // World border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.strokeRect(-cameraX, -cameraY, WORLD_WIDTH, WORLD_HEIGHT);

      // Player name
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        playerName,
        player.x - cameraX,
        player.y - PLAYER_SIZE / 2 - cameraY - 10
      );

      // Health bar
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(
        player.x - cameraX - 50,
        player.y + PLAYER_SIZE / 2 - cameraY + 10,
        health,
        10
      );

      // Player sprite (swapped via shake gesture)
      updateShakeToSwapSprite();
      const currentSprite = shark ? catImage : sharkImage;

      ctx.drawImage(
        currentSprite,
        player.x - PLAYER_SIZE / 2 - cameraX,
        player.y - PLAYER_SIZE / 2 - cameraY,
        PLAYER_SIZE,
        PLAYER_SIZE
      );

      // Shield
      if (keys[" "]) {
        ctx.fillStyle = "rgba(0, 255, 255, 0.5)";
        ctx.fillRect(
          player.x - cameraX - PLAYER_SIZE / 2 - 10,
          player.y - cameraY - PLAYER_SIZE / 2 - 10,
          PLAYER_SIZE + 20,
          PLAYER_SIZE + 20
        );
      }

      // Attack swing
      if (attackTime > 0) {
        const screenPlayerX = player.x - cameraX;
        const screenPlayerY = player.y - cameraY;

        const attackDx = pointer.x - screenPlayerX;
        const attackDy = pointer.y - screenPlayerY;

        const length = Math.hypot(attackDx, attackDy);
        const dirX = attackDx / length;
        const dirY = attackDy / length;

        const attackLength = 300;

        ctx.strokeStyle = "#ffaa00";
        ctx.lineWidth = 4;

        ctx.beginPath();
        ctx.moveTo(screenPlayerX + dirX * 50, screenPlayerY + dirY * 50);
        ctx.lineTo(
          screenPlayerX + dirX * attackLength,
          screenPlayerY + dirY * attackLength
        );
        ctx.stroke();
      }

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", startTouchInput);
      canvas.removeEventListener("pointermove", updateTouchInput);
      canvas.removeEventListener("pointerup", endTouchInput);
      canvas.removeEventListener("pointercancel", endTouchInput);
      window.removeEventListener("pointerdown", attackPointerDown);
      canvas.removeEventListener("pointermove", updatePointerPosition);
    };
  }, []);

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
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    />
  );
}