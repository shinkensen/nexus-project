"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export default function Controller() {
    const socketRef = useRef<any>(null);

    useEffect(() => {
        const socket = io("http://localhost:3001");
        socketRef.current = socket;

        return () => socket.disconnect();
    }, []);

    function send(dx: number, dy: number) {
        socketRef.current?.emit("input", { dx, dy });
    }

    function handlePointerMove(e: React.PointerEvent) {
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;

        send(dx, dy);
    }

    return (
        <div
            onPointerMove={handlePointerMove}
            style={{
                height: "100vh",
                background: "black",
                touchAction: "none",
            }}
        >
            <p style={{ color: "white" }}>Move finger to control</p>
        </div>
    );
}