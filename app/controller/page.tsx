"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function Controller() {
    const socketRef = useRef<any>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });

    const joystickRef = useRef({
        active: false,
        pointerId: -1,
        originX: 0,
        originY: 0,
        x: 0,
        y: 0,
    });

    const sendRef = useRef({ dx: 0, dy: 0 });

    useEffect(() => {
        const socket = io("http://localhost:3001");
        socketRef.current = socket;

        // Joystick interval stream
        const interval = setInterval(() => {
            socket.emit("input", sendRef.current);
        }, 50); // 20 updates/sec

        return () => {
            clearInterval(interval);
            socket.disconnect();
        };
    }, []);

    // --- Joystick Helpers ---
    function clampJoystick(dx: number, dy: number, max: number) {
        const dist = Math.hypot(dx, dy);
        if (dist <= max) return { dx, dy };

        const scale = max / dist;
        return { dx: dx * scale, dy: dy * scale };
    }

    function onPointerDown(e: React.PointerEvent) {
        // Stop joystick logic if clicking on any button inside the test overlay
        if ((e.target as HTMLElement).closest('button')) return;

        joystickRef.current.active = true;
        joystickRef.current.pointerId = e.pointerId;

        joystickRef.current.originX = e.clientX;
        joystickRef.current.originY = e.clientY;
        joystickRef.current.x = e.clientX;
        joystickRef.current.y = e.clientY;
    }

    function onPointerMove(e: React.PointerEvent) {
        if (!joystickRef.current.active || e.pointerId !== joystickRef.current.pointerId)
            return;

        joystickRef.current.x = e.clientX;
        joystickRef.current.y = e.clientY;

        const dx = joystickRef.current.x - joystickRef.current.originX;
        const dy = joystickRef.current.y - joystickRef.current.originY;

        const MAX = 80;
        const clamped = clampJoystick(dx, dy, MAX);

        setKnob({ x: clamped.dx, y: clamped.dy });

        sendRef.current.dx = clamped.dx / MAX;
        sendRef.current.dy = clamped.dy / MAX;
    }

    function onPointerUp(e: React.PointerEvent) {
        if (e.pointerId !== joystickRef.current.pointerId) return;

        joystickRef.current.active = false;
        setKnob({ x: 0, y: 0 });
        
        sendRef.current.dx = 0;
        sendRef.current.dy = 0;
    }

    return (
        <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
                height: "100vh",
                background: "#000",
                touchAction: "none",
                position: "relative",
                overflow: "hidden",
                userSelect: "none"
            }}
        >
            <p style={{ color: "white", padding: 20 }}>Joystick Controller</p>

            {/* ======================================================== */}
            {/* 1. REMOVE LATER: TEST BUTTON OVERLAY                     */}
            {/* ======================================================== */}
            <TestActionButtons socketRef={socketRef} />
            {/* ======================================================== */}

            {/* Joystick Base Container */}
            <div
                style={{
                    position: "absolute",
                    bottom: 60,
                    left: 60,
                    width: 140,
                    height: 140,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.08)",
                        border: "2px solid rgba(255,255,255,0.2)",
                    }}
                />

                <div
                    style={{
                        position: "absolute",
                        left: 70 + knob.x,
                        top: 70 + knob.y,
                        width: 60,
                        height: 60,
                        borderRadius: "50%",
                        background: "white",
                        transform: "translate(-50%, -50%)",
                        transition: joystickRef.current.active ? "none" : "0.15s",
                    }}
                />
            </div>
        </div>
    );
}

/**
 * ============================================================================
 * TEST TOOLS COMPONENT (Safely delete this whole component when done testing)
 * ============================================================================
 */
function TestActionButtons({ socketRef }: { socketRef: React.MutableRefObject<any> }) {
    const [shieldActive, setShieldActive] = useState(false);
    const [attackCooldown, setAttackCooldown] = useState(false);

    const SHIELD_DURATION = 3000; // Shield stays up for 3 seconds
    const ATTACK_COOLDOWN_TIME = 300;

    const handleShield = () => {
        if (shieldActive || !socketRef.current) return;
        
        // Turn shield ON
        socketRef.current.emit("shield", true);
        setShieldActive(true);

        // Turn shield OFF after 3 seconds
        setTimeout(() => {
            socketRef.current?.emit("shield", false);
            setShieldActive(false);
        }, SHIELD_DURATION);
    };

    const handleAttack = () => {
        if (attackCooldown || !socketRef.current) return;

        socketRef.current.emit("attack");
        setAttackCooldown(true);

        setTimeout(() => {
            setAttackCooldown(false);
        }, ATTACK_COOLDOWN_TIME);
    };

    return (
        <div 
            style={{ 
                position: "absolute", 
                bottom: 220, 
                left: 60, 
                display: "flex", 
                flexDirection: "column", 
                gap: "10px", 
                width: "140px",
                zIndex: 10
            }}
        >
            <button
                onClick={handleShield}
                disabled={shieldActive}
                style={{
                    padding: "12px",
                    borderRadius: "8px",
                    border: "none",
                    background: shieldActive ? "#333" : "#00bcd4",
                    color: shieldActive ? "#888" : "#fff",
                    fontWeight: "bold",
                    cursor: shieldActive ? "not-allowed" : "pointer",
                    opacity: shieldActive ? 0.6 : 1,
                }}
            >
                {shieldActive ? "SHIELD ACTIVE" : "SHIELD"}
            </button>

            <button
                onClick={handleAttack}
                disabled={attackCooldown}
                style={{
                    padding: "12px",
                    borderRadius: "8px",
                    border: "none",
                    background: attackCooldown ? "#333" : "#f44336",
                    color: attackCooldown ? "#666" : "#fff",
                    fontWeight: "bold",
                    cursor: attackCooldown ? "not-allowed" : "pointer",
                    opacity: attackCooldown ? 0.6 : 1,
                }}
            >
                {attackCooldown ? "ATTACK [CD]" : "ATTACK"}
            </button>
        </div>
    );
}