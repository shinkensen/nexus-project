"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../backend/supabase";

export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 1000;
export const PLAYER_SIZE = 100;
export const GRID_SIZE = 50;

type Player = {
    id: string | number;
    playerX: number;
    playerY: number;
    shark?: boolean;
    shield?: boolean;
    username?: string;
};

export default function Overview() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [players, setPlayers] = useState<Player[]>([]);
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

    useEffect(() => {
        playersRef.current = players;
    }, [players]);

    // preload sprites
    useEffect(() => {
        const cat = new Image();
        cat.src = "/assets/sprites/cat-removebg-preview.png";

        const shark = new Image();
        shark.src = "/assets/sprites/shark-removebg-preview.png";

        const shield = new Image();
        shield.src = "/assets/sprites/shield.png";

        imagesRef.current = { cat, shark, shield };
    }, []);

    // initial fetch + realtime updates
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
                console.log(data);
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
                    setPlayers((prev) => {
                        if (payload.eventType === "INSERT") {
                            const newPlayer = payload.new as Player;
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

    // render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // FIXED WORLD SIZE
        canvas.width = WORLD_WIDTH;
        canvas.height = WORLD_HEIGHT;

        let animationFrameId = 0;

        const clamp = (value: number, min: number, max: number) => {
            return Math.max(min, Math.min(max, value));
        };

        const drawGrid = () => {
            ctx.strokeStyle = "#d0d0d0";
            ctx.lineWidth = 1;

            // vertical lines
            for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, WORLD_HEIGHT);
                ctx.stroke();
            }

            // horizontal lines
            for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(WORLD_WIDTH, y);
                ctx.stroke();
            }
        };

        const drawPlayer = (player: Player) => {
            const { cat, shark, shield } = imagesRef.current;

            // Draw directly in world coordinates
            const x = clamp(player.playerX, 0, WORLD_WIDTH - PLAYER_SIZE);
            const y = clamp(player.playerY, 0, WORLD_HEIGHT - PLAYER_SIZE);

            let sprite: HTMLImageElement | null = null;

            if (player.shield) {
                sprite = shield;
            } else if (player.shark) {
                sprite = shark;
            } else {
                sprite = cat;
            }

            if (sprite && sprite.complete) {
                ctx.drawImage(sprite, x, y, PLAYER_SIZE, PLAYER_SIZE);
            } else {
                ctx.fillStyle = player.shark ? "#4f8cff" : "#ff7b7b";
                ctx.fillRect(x, y, PLAYER_SIZE, PLAYER_SIZE);
            }

            if (player.username) {
                ctx.fillStyle = "black";
                ctx.font = "16px Arial";
                ctx.textAlign = "center";
                ctx.fillText(player.username, x + PLAYER_SIZE / 2, y - 8);
            }
        };

        const render = () => {
            ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

            // background
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

            // grid
            drawGrid();

            // players
            for (const player of playersRef.current) {
                drawPlayer(player);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <div
            style={{
                width: "100vw",
                height: "100vh",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                overflow: "auto",
                background: "#f5f5f5",
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: "1000px",
                    height: "1000px",
                    background: "white",
                    border: "1px solid #ccc",
                    display: "block",
                }}
            />
        </div>
    );
}