"use client";

/**
 * =============================================================================
 *  /host
 * -----------------------------------------------------------------------------
 *  This is the page that runs on the big shared display (a TV, a laptop on a
 *  projector, etc). It has no input of its own - it's a pure read-only view
 *  of whatever the server (server/index.js) broadcasts in "state".
 *
 *  Every phone on /controller shows up here automatically: the server keys
 *  players by socket.id, and this page just iterates whatever's in
 *  `state.players` on each render, so N controllers just means N dots with
 *  no changes needed in this file.
 * =============================================================================
 */

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

// Falls back to localhost:3001 for local same-machine dev. See README.md
// for pointing this at a tunneled server URL.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

export const PLAYER_SIZE = 100;
export const GRID_SIZE = 50;

type HostPlayer = { id: string; name: string; x: number; y: number; dx: number; dy: number };
type HostAttack = { x: number; y: number; angle: number };

export default function Host() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<HostPlayer[]>([]);
  const attacksRef = useRef<HostAttack[]>([]);
  const imagesRef = useRef<{
    cat: HTMLImageElement | null;
    shark: HTMLImageElement | null;
    shield: HTMLImageElement | null;
    map: HTMLImageElement | null;
  }>({
    cat: null,
    shark: null,
    shield: null,
    map: null,
  });

  useEffect(() => {
    // extraHeaders bypasses ngrok's free-tier interstitial warning page,
    // which otherwise breaks the socket.io handshake on first connect.
    const socket = io(SOCKET_URL, {
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
    });
    socket.on("state", (state: { players: HostPlayer[]; attacks?: HostAttack[] }) => {
      playersRef.current = state.players;
      // Defensive default - older server builds (or a mid-deploy server)
      // might not send "attacks" at all yet.
      attacksRef.current = state.attacks ?? [];
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const cat = new Image();
    cat.src = "/assets/sprites/cat-removebg-preview.png";
    const shark = new Image();
    shark.src = "/assets/sprites/shark-removebg-preview.png";
    const shield = new Image();
    shield.src = "/assets/objects/box-removebg-preview.png";
    const map = new Image();
    map.src = "/assets/map/combined_sides.png";
    imagesRef.current = { cat, shark, shield, map };

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (imagesRef.current.map?.complete) {
        ctx.drawImage(imagesRef.current.map!, 0, 0, canvas.width, canvas.height);
      }

      for (const p of playersRef.current) {
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(p.x * 0.1, p.y * 0.1, 10, 0, Math.PI * 2);
        ctx.fill();

        // Name label - small addition so multiple players on screen are
        // distinguishable at a glance.
        if (p.name) {
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "12px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText(p.name, p.x * 0.1, p.y * 0.1 - 16);
        }
      }

      for (const a of attacksRef.current) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + Math.cos(a.angle) * 200, a.y + Math.sin(a.angle) * 200);
        ctx.stroke();
      }

      requestAnimationFrame(loop);
    }
    loop();

    return () => window.removeEventListener("resize", resize);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh" }} />;
}