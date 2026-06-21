"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export default function Host() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const playersRef = useRef<any[]>([]);
    const fxRef = useRef<any[]>([]);

    const WORLD_SCALE = 0.1;

    useEffect(() => {
        const socket = io("http://localhost:3001");

        socket.on("state", (state) => {
            playersRef.current = state.players;
        });

        socket.on("attack_fx", (fx) => {
            fxRef.current.push({
                ...fx,
                t: 0,
            });
        });

        return () => { socket.disconnect(); };
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

        let last = performance.now();

        const MAX_TIME = 0.25;

        const ATTACK_RANGE_WORLD = 3000;
        const ATTACK_RANGE_SCREEN = ATTACK_RANGE_WORLD * WORLD_SCALE;

        const ATTACK_ANGLE = Math.PI / 6;

        function updateFX(dt: number) {
            for (const fx of fxRef.current) {
                fx.t += dt;
            }

            fxRef.current = fxRef.current.filter(
                (fx) => fx.t < MAX_TIME
            );
        }

        function loop(now: number) {
            const dt = (now - last) / 1000;
            last = now;

            updateFX(dt);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // ===== players =====
            for (const p of playersRef.current) {
                ctx.fillStyle = "white";
                ctx.beginPath();
                ctx.arc(
                    p.x * WORLD_SCALE,
                    p.y * WORLD_SCALE,
                    10,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }

            // ===== attack FX =====
            for (const fx of fxRef.current) {
                const progress = fx.t / MAX_TIME;
                const alpha = 1 - progress;

                const x = fx.x * WORLD_SCALE;
                const y = fx.y * WORLD_SCALE;

                ctx.fillStyle = `rgba(255,80,80,${alpha * 0.35})`;

                ctx.beginPath();
                ctx.moveTo(x, y);

                for (let i = 0; i <= 12; i++) {
                    const a =
                        fx.angle -
                        ATTACK_ANGLE / 2 +
                        (ATTACK_ANGLE * i) / 12;

                    const px = x + Math.cos(a) * ATTACK_RANGE_SCREEN;
                    const py = y + Math.sin(a) * ATTACK_RANGE_SCREEN;

                    ctx.lineTo(px, py);
                }

                ctx.closePath();
                ctx.fill();
            }

            requestAnimationFrame(loop);
        }

        requestAnimationFrame(loop);

        return () => {
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: "100vw", height: "100vh" }}
        />
    );
}