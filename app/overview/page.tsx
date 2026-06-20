"use client";

import { useState, useEffect, useRef } from "react";

export default function Overview() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        resize();
        window.addEventListener("resize", resize);

        // Example: Draw a simple grid
        const gridSize = 50;
        ctx.strokeStyle = "#ccc";
        for (let x = 0; x < canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // grab all players (placeholder) and draw them. sprite shark/cat based on shark boolean. also draw health bar and name above them
            const players: any[] = []

            players.forEach(player => {
                const screenX = player.x;
                const screenY = player.y;

                // draw player sprite (placeholder)
                ctx.fillStyle = player.shark ? "blue" : "orange";
                ctx.beginPath();
                ctx.arc(screenX, screenY, 20, 0, Math.PI * 2);
                ctx.fill();
                
                // draw health bar
                ctx.fillStyle = "red";
                ctx.fillRect(screenX - 25, screenY - 40, 50 * (player.health / 100), 5);
            });

        return () => {
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <div>
            <canvas
                ref={canvasRef}
                style={{
                    display: "block",
                    width: "100vw",
                    height: "100vh",
                    touchAction: "none",
                }}
            />
        </div>
    );
}