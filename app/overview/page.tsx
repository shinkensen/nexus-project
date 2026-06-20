"use client";

import { useState, useEffect, useRef } from "react";

export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000; // pixels/sec


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
            let screenX = player.x;
            let screenY = player.y;

            if (screenX < 0) screenX = 0;
            if (screenY < 0) screenY = 0;
            if (screenX > canvas.width) screenX = canvas.width;
            if (screenY > canvas.height) screenY = canvas.height;

            // draw player sprite image

            const playerImage = new Image();
            // playerImage.src = "/assets/sprites/cat-removebg-preview.png";
            // depends based on shark boolean
            playerImage.src = player.shark ? "/assets/sprites/cat-removebg-preview.png"
                : "/assets/sprites/shark-removebg-preview.png";
            playerImage.width = PLAYER_SIZE;
            playerImage.height = PLAYER_SIZE;

            // draw health bar
            ctx.fillStyle = "red";
            ctx.fillRect(screenX - 25, screenY - 40, 50 * (player.health / 100), 5);

            if (player.shield) {
                ctx.fillStyle = "rgba(0, 255, 255, 0.5)";
                ctx.fillRect(
                    player.x - PLAYER_SIZE / 2 - 10,
                    player.y - PLAYER_SIZE / 2 - 10,
                    PLAYER_SIZE + 20,
                    PLAYER_SIZE + 20
                );
            }
        });

        // handle attacks from supabase
        const attacks: any[] = [];

        attacks.forEach((attack) => {

            const attackLength = 300;
            const angle = attack.direction; // assuming direction is in radians
            const startX = attack.playerX;
            const startY = attack.playerY;
            const endX = startX + attackLength * Math.cos(angle);
            const endY = startY + attackLength * Math.sin(angle);
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