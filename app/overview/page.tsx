"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../backend/supabase";

export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 3000;
export const PLAYER_SIZE = 100;
export const GRID_SIZE = 50;

type Player = {
    id: string | number;
    positionX: number;
    positionY: number;
    gold: number;
    shark: boolean;
    shield: boolean;
    name: string;
};

export default function Overview() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Current players from Supabase
    const [players, setPlayers] = useState<Player[]>([]);

    // Refs so the render loop always has the newest values without restarting
    const playersRef = useRef<Player[]>([]);
    const imagesRef = useRef<{
        cat: HTMLImageElement | null;
        shark: HTMLImageElement | null;
        shield: HTMLImageElement | null;
    }>({
        cat: null,
        shark: null,
        shield: null,
    });

    // keep ref in sync with state
    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    // preload sprites once
    useEffect(() => {
        const cat = new Image();
        cat.src = "/assets/sprites/cat-removebg-preview.png";

        const shark = new Image();
        shark.src = "/assets/sprites/shark-removebg-preview.png";

        const shield = new Image();
        shield.src = "/assets/sprites/shield.png";

        imagesRef.current = { cat, shark, shield };
    }, []);

    // initial fetch + realtime subscription
    useEffect(() => {
        let mounted = true;

        const loadPlayers = async () => {
            const { data, error } = await supabase.from("game").select("*");

            if (error) {
                console.error("Failed to fetch players:", error.message);
                return;
            }

            if (mounted && data) {
                setPlayers(data as Player[]);
            }
        };

        loadPlayers();

        const channel = supabase
            .channel("overview-game-realtime")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "game",
                },
                (payload) => {
                    console.log("Realtime change:", payload);

                    setPlayers((prev) => {
                        if (payload.eventType === "INSERT") {
                            const newPlayer = payload.new as Player;

                            // avoid duplicate inserts
                            const exists = prev.some((p) => p.id === newPlayer.id);
                            if (exists) {
                                return prev.map((p) =>
                                    p.id === newPlayer.id ? newPlayer : p
                                );
                            }

                            return [...prev, newPlayer];
                        }

                        if (payload.eventType === "UPDATE") {
                            const updatedPlayer = payload.new as Player;
                            return prev.map((p) =>
                                p.id === updatedPlayer.id ? updatedPlayer : p
                            );
                        }

                        if (payload.eventType === "DELETE") {
                            const deletedPlayer = payload.old as Player;
                            return prev.filter((p) => p.id !== deletedPlayer.id);
                        }

                        return prev;
                    });
                }
            )
            .subscribe((status) => {
                console.log("Supabase channel status:", status);
            });

        return () => {
            mounted = false;
            supabase.removeChannel(channel);
        };
    }, []);

    // canvas sizing + render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationFrameId = 0;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };

        const clamp = (value: number, min: number, max: number) => {
            return Math.max(min, Math.min(max, value));
        };

        const drawGrid = () => {
            ctx.strokeStyle = "#d0d0d0";
            ctx.lineWidth = 1;

            // vertical lines
            for (let x = 0; x <= canvas.width; x += GRID_SIZE) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }

            // horizontal lines
            for (let y = 0; y <= canvas.height; y += GRID_SIZE) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        };

        const drawPlayer = (player: Player) => {
            const { cat, shark, shield } = imagesRef.current;

            // If your overview is just showing the world directly, use player coords as screen coords.
            // Clamp them so sprites don't go off-screen.
            const screenX = clamp(player.positionX, 0, canvas.width - PLAYER_SIZE);
            const screenY = clamp(player.positionY, 0, canvas.height - PLAYER_SIZE);

            let sprite: HTMLImageElement | null = null;

            if (player.shield) {
                sprite = shield;
            } else if (player.shark) {
                sprite = cat;
            } else {
                sprite = shark;
            }

            // draw sprite if loaded, otherwise fallback rectangle
            if (sprite && sprite.complete) {
                ctx.drawImage(sprite, screenX, screenY, PLAYER_SIZE, PLAYER_SIZE);
            } else {
                ctx.fillStyle = player.shark ? "#4f8cff" : "#ff7b7b";
                ctx.fillRect(screenX, screenY, PLAYER_SIZE, PLAYER_SIZE);
            }

            // optional label
            if (player.name) {
                ctx.fillStyle = "black";
                ctx.font = "16px Arial";
                ctx.textAlign = "center";
                ctx.fillText(
                    player.name,
                    screenX + PLAYER_SIZE / 2,
                    screenY - 8
                );
            }
        };

        const render = () => {
            // clear screen
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // background
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // grid
            drawGrid();

            // players
            for (const player of playersRef.current) {
                drawPlayer(player);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        resize();
        render();

        window.addEventListener("resize", resize);

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener("resize", resize);
        };
    });

    return (
        <div>
            <canvas
                ref={canvasRef}
                style={{
                    display: "block",
                    width: "100vw",
                    height: "100vh",
                    touchAction: "none",
                    background: "white",
                }}
            />
        </div>
    );
}