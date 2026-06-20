"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../backend/supabase";

export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000; // pixels/sec

type Player = {
    id: string | number;
    playerX: number;
    playerY: number;
    shark: boolean;
    shield: boolean;
};

export default function Overview() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [players, setPlayers] = useState<Player[]>([]);

    // Initial fetch + realtime subscription
    useEffect(() => {
        const fetchPlayers = async () => {
            const { data, error } = await supabase.from("game").select("*");

            if (error) {
                console.error(error.message);
                return;
            }

            setPlayers((data as Player[]) ?? []);
        };

        fetchPlayers();

        const channel = supabase
            .channel("game-realtime")
            .on(
                "postgres_changes",
                {
                    event: "*", // INSERT, UPDATE, DELETE
                    schema: "public",
                    table: "game",
                },
                (payload) => {
                    console.log("Realtime change:", payload);

                    setPlayers((prev) => {
                        if (payload.eventType === "INSERT") {
                            return [...prev, payload.new as Player];
                        }

                        if (payload.eventType === "UPDATE") {
                            return prev.map((player) =>
                                player.id === payload.new.id
                                    ? (payload.new as Player)
                                    : player
                            );
                        }

                        if (payload.eventType === "DELETE") {
                            return prev.filter(
                                (player) => player.id !== payload.old.id
                            );
                        }

                        return prev;
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Draw whenever players change
    useEffect(() => {
        const canvas = canvasRef.current!;
        if (!canvas) return;

        const ctx = canvas.getContext("2d")!;
        if (!ctx) return;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            draw();
        }

        function draw() {
            // clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // grid
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

            // draw players
            players.forEach((player) => {
                let screenX = player.playerX;
                let screenY = player.playerY;

                if (screenX < 0) screenX = 0;
                if (screenY < 0) screenY = 0;
                if (screenX > canvas.width - PLAYER_SIZE) {
                    screenX = canvas.width - PLAYER_SIZE;
                }
                if (screenY > canvas.height - PLAYER_SIZE) {
                    screenY = canvas.height - PLAYER_SIZE;
                }

                const playerImage = new Image();
                playerImage.src = player.shield
                    ? "/assets/sprites/shield.png"
                    : player.shark
                    ? "/assets/sprites/cat-removebg-preview.png"
                    : "/assets/sprites/shark-removebg-preview.png";

                playerImage.onload = () => {
                    ctx.drawImage(
                        playerImage,
                        screenX,
                        screenY,
                        PLAYER_SIZE,
                        PLAYER_SIZE
                    );
                };
            });
        }

        resize();
        draw();

        window.addEventListener("resize", resize);

        return () => {
            window.removeEventListener("resize", resize);
        };
    }, [players]);

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