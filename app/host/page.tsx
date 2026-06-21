"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export default function Host() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const playersRef = useRef<any[]>([]);
    const fxRef = useRef<any[]>([]);

    useEffect(() => {
        const socket = io("http://localhost:3001");

        socket.on("connect", () => {
            console.log("connected to server");
        });

        socket.on("state", (state) => {
            playersRef.current = state.players;
        });

        socket.on("attack_fx", (fx) => {
            fxRef.current.push({
                x: fx.x,
                y: fx.y,
                angle: fx.angle,
                t: 0,
            });

            console.log("FX RECEIVED", fx);
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

        let last = performance.now();

        const MAX_TIME = 0.25;
        const RANGE = 400 * 0.1;
        const spread = Math.PI / 3;

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

            // players
            for (const p of playersRef.current) {
                ctx.fillStyle = "white";
                ctx.beginPath();
                ctx.arc(p.x * 0.1, p.y * 0.1, 10, 0, Math.PI * 2);
                ctx.fill();
            }

            // FX
            for (const fx of fxRef.current) {
                const progress = fx.t / MAX_TIME;
                const alpha = 1 - progress;

                const x = fx.x * 0.1;
                const y = fx.y * 0.1;

                ctx.fillStyle = `rgba(255, 80, 80, ${alpha * 0.35})`;

                ctx.beginPath();
                ctx.moveTo(x, y);

                for (let i = 0; i <= 12; i++) {
                    const a =
                        fx.angle -
                        spread / 2 +
                        (spread * i) / 12;

                    const px = x + Math.cos(a) * RANGE;
                    const py = y + Math.sin(a) * RANGE;

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