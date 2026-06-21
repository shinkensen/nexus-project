"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export const PLAYER_SIZE = 100;
export const GRID_SIZE = 50;

export default function Host() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<any[]>([]);
  const attacksRef = useRef<any[]>([]);


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
    const socket = io("http://localhost:3001");

    socket.on("state", (state) => {
      playersRef.current = state.players;
      attacksRef.current = state.attacks;
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
        ctx.drawImage(
          imagesRef.current.map!,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }

      for (const p of playersRef.current) {
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(p.x * 0.1, p.y * 0.1, 10, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const a of attacksRef.current) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(
          a.x + Math.cos(a.angle) * 200,
          a.y + Math.sin(a.angle) * 200
        );
        ctx.stroke();
      }

      requestAnimationFrame(loop);
    }

    loop();

    return () => window.removeEventListener("resize", resize);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh" }} />;
}