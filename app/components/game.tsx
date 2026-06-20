"use client";

import { useEffect, useRef } from "react";

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

const PLAYER_SIZE = 30;
const PLAYER_SPEED = 350; // pixels/sec

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

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

    const keys: Record<string, boolean> = {};

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

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    let last = performance.now();

    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

      let dx = 0;
      let dy = 0;

      if (keys["w"] || keys["arrowup"]) dy--;
      if (keys["s"] || keys["arrowdown"]) dy++;
      if (keys["a"] || keys["arrowleft"]) dx--;
      if (keys["d"] || keys["arrowright"]) dx++;

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

      // Player
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(
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
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100vw",
        height: "100vh",
      }}
    />
  );
}