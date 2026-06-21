"use client";

import { useState, useEffect, useRef } from "react";

export default function Controller() {
    const [name, setName] = useState("");
    const [joined, setJoined] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const channelRef = useRef<any>(null);

    function connectAndJoin(playerName: string) {
        let backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://165.22.144.193";
        // Ensure the URL is absolute by prepending http:// if protocol is missing
        if (backendUrl && !backendUrl.startsWith("http://") && !backendUrl.startsWith("https://")) {
            backendUrl = `http://${backendUrl}`;
        }
        const isHttps = backendUrl.startsWith("https://");
        console.log(`[CLIENT LOG] Attempting connection. Target URL: ${backendUrl}, Port: ${isHttps ? "default/443" : "3001"}`);
        setStatusMsg(`Connecting to ${backendUrl}...`);
        
        // Dynamic import to prevent any SSR issues with WebRTC objects in Next.js build
        import("@geckos.io/client")
            .then((module) => {
                const geckos = module.default;
                const channel = geckos({ url: backendUrl, port: isHttps ? undefined : 3001 });

                channel.onConnect((error) => {
                    if (error) {
                        console.error("[CLIENT LOG] Connection error object:", error);
                        setStatusMsg(`Connection error: ${error.message}. Check browser console.`);
                        return;
                    }

                    console.log(`[CLIENT LOG] Connected to server! Channel ID: ${channel.id}`);
                    console.log(`[CLIENT LOG] Emitting 'join' with name: "${playerName}"`);
                    channel.emit("join", { name: playerName });
                    channelRef.current = channel;
                    setJoined(true);
                });

                channel.onDisconnect(() => {
                    console.warn("[CLIENT LOG] Disconnected from server.");
                    setJoined(false);
                    setStatusMsg("Disconnected from server");
                });
            })
            .catch((err) => {
                console.error("[CLIENT LOG] Failed to dynamically load geckos client library:", err);
                setStatusMsg("Failed to initialize game client package");
            });
    }

    function handleJoin(e: React.FormEvent) {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return;
        connectAndJoin(trimmedName);
    }

    function send(dx: number, dy: number) {
        channelRef.current?.emit("input", { dx, dy });
    }

    function handlePointerMove(e: React.PointerEvent) {
        if (!joined) return;
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;

        send(dx, dy);
    }

    if (!joined) {
        return (
            <div
                style={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "radial-gradient(circle at center, #1a1a2e 0%, #0f0f1b 100%)",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    color: "#fff",
                }}
            >
                <form
                    onSubmit={handleJoin}
                    style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        backdropFilter: "blur(10px)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "16px",
                        padding: "32px",
                        width: "90%",
                        maxWidth: "400px",
                        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
                        textAlign: "center",
                    }}
                >
                    <h2 style={{ marginBottom: "8px", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.5px" }}>
                        Enter Arena
                    </h2>
                    <p style={{ color: "#8a8a9e", fontSize: "14px", marginBottom: "24px" }}>
                        Choose your name to join the host lobby.
                    </p>

                    <input
                        type="text"
                        placeholder="Player Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={15}
                        required
                        style={{
                            width: "100%",
                            padding: "12px 16px",
                            borderRadius: "8px",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            background: "rgba(0, 0, 0, 0.3)",
                            color: "#fff",
                            fontSize: "16px",
                            marginBottom: "16px",
                            outline: "none",
                            boxSizing: "border-box",
                            transition: "border-color 0.3s ease",
                        }}
                    />

                    <button
                        type="submit"
                        style={{
                            width: "100%",
                            padding: "12px",
                            borderRadius: "8px",
                            border: "none",
                            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                            color: "#fff",
                            fontSize: "16px",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        Join Game
                    </button>

                    {statusMsg && (
                        <p style={{ marginTop: "16px", color: "#f87171", fontSize: "14px" }}>
                            {statusMsg}
                        </p>
                    )}
                </form>
            </div>
        );
    }

    return (
        <div
            onPointerMove={handlePointerMove}
            style={{
                height: "100vh",
                background: "radial-gradient(circle at center, #111 0%, #000 100%)",
                touchAction: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "system-ui, sans-serif",
                userSelect: "none",
            }}
        >
            <div style={{ pointerEvents: "none", textAlign: "center" }}>
                <p style={{ color: "#6366f1", fontSize: "24px", fontWeight: "bold", margin: 0 }}>
                    Connected as {name}
                </p>
                <p style={{ color: "#888", fontSize: "14px", marginTop: "8px" }}>
                    Drag finger or mouse to control your player
                </p>
            </div>
        </div>
    );
}