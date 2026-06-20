"use client";

import { useEffect, useRef } from "react";

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

const PLAYER_SIZE = 100;
const PLAYER_SPEED = 1000; // pixels/sec

export default function Game({ playerName }: { playerName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  let health = 100;
  let shark = true;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const playerImage = new Image();
    playerImage.src = "/assets/sprites/cat-removebg-preview.png";

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

    const player = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
    };

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

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", startTouchInput);
    canvas.addEventListener("pointermove", updateTouchInput);
    canvas.addEventListener("pointerup", endTouchInput);
    canvas.addEventListener("pointercancel", endTouchInput);

    function attack() { }
    function stealMoney() { }
    function dropMoney() { }
    function pickupShield() { }
    function dropShield() { }

    let last = performance.now();
    const maxTouchDistance = 90;

    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

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
        const touchStrength = Math.min(1, touchDistance / maxTouchDistance);

        if (touchDistance > 0) {
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

      player.x += dx * PLAYER_SPEED * dt;
      player.y += dy * PLAYER_SPEED * dt;

      // Keep player inside world
      player.x = Math.max(
        PLAYER_SIZE / 2,
        Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, player.x)
      );
      player.y = Math.max(
        PLAYER_SIZE / 2,
        Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, player.y)
      );

      // Camera follows player
      const cameraX = Math.max(
        0,
        Math.min(WORLD_WIDTH - width, player.x - width / 2)
      );

      const cameraY = Math.max(
        0,
        Math.min(WORLD_HEIGHT - height, player.y - height / 2)
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
      ctx.strokeRect(
        -cameraX,
        -cameraY,
        WORLD_WIDTH,
        WORLD_HEIGHT
      );

      // display playername under neath image
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText(playerName, player.x - cameraX, player.y - PLAYER_SIZE / 2 - cameraY - 10);

      // draw health and shield bar BELOW player image, and make them filled up based on a variable

      ctx.fillStyle = "#ff0000";
      ctx.fillRect(player.x - cameraX - 50, player.y + PLAYER_SIZE / 2 - cameraY + 10, health, 10);

      const playerImage = new Image();
      // playerImage.src = "/assets/sprites/cat-removebg-preview.png";
      // depends based on shark boolean
      playerImage.src = shark ? "/assets/sprites/cat-removebg-preview.png"
        : "/assets/sprites/shark-removebg-preview.png";
      playerImage.width = PLAYER_SIZE;
      playerImage.height = PLAYER_SIZE;

      ctx.drawImage(
        playerImage,
        player.x - PLAYER_SIZE / 2 - cameraX,
        player.y - PLAYER_SIZE / 2 - cameraY,
        PLAYER_SIZE,
        PLAYER_SIZE
      );

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
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100vw",
        height: "100vh",
        touchAction: "none",
      }}
    />
  );
}