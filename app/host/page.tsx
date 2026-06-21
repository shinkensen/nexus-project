"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export default function Host() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playersRef = useRef<any[]>([]);

  useEffect(() => {
    const socket = io("http://localhost:3001");

    socket.on("state", (state) => {
      playersRef.current = state.players;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
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

      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const p of playersRef.current) {
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(p.x * 0.1, p.y * 0.1, 10, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(loop);
    }

    loop();

    return () => window.removeEventListener("resize", resize);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh" }} />;
}