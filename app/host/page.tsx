"use client";

import { useEffect, useRef } from "react";

export default function Host() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const playersRef = useRef<any[]>([]);
    const attacksRef = useRef<any[]>([]);

    useEffect(() => {
        let channel: any = null;

        let backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://165.22.144.193";
        // Ensure the URL is absolute by prepending http:// if protocol is missing
        if (backendUrl && !backendUrl.startsWith("http://") && !backendUrl.startsWith("https://")) {
            backendUrl = `http://${backendUrl}`;
        }
        const isHttps = backendUrl.startsWith("https://");
        console.log(`[HOST LOG] Attempting connection. Target URL: ${backendUrl}, Port: ${isHttps ? "default/443" : "3001"}`);

        import("@geckos.io/client")
            .then((module) => {
                const geckos = module.default;
                channel = geckos({ url: backendUrl, port: isHttps ? null : 3001 });

                channel.onConnect((error: any) => {
                    if (error) {
                        console.error("[HOST LOG] Connection error object:", error);
                        return;
                    }
                    console.log(`[HOST LOG] Connected to server successfully! Channel ID: ${channel.id}`);

                    channel.on("state", (state: any) => {
                        console.log(`[HOST LOG] Received state: ${state.players?.length || 0} players active.`);
                        playersRef.current = state.players || [];
                        attacksRef.current = state.attacks || [];
                    });
                });
            })
            .catch((err) => {
                console.error("[HOST LOG] Failed to dynamically load geckos client library:", err);
            });

        return () => {
            if (channel) {
                channel.close();
            }
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

            ctx.fillStyle = "#0f0f1b";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (const p of playersRef.current) {
                const px = p.x * 0.1;
                const py = p.y * 0.1;

                // Draw player circle
                ctx.fillStyle = "#6366f1";
                ctx.beginPath();
                ctx.arc(px, py, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = "#ffffff";
                ctx.stroke();

                // Draw player name above the circle
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 14px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(p.name || "Anonymous", px, py - 20);
            }

            for (const a of attacksRef.current) {
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 3;
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

    return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />;
}