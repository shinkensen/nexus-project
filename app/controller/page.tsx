"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function Controller() {
    const socketRef = useRef<any>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });

    // Cooldown states for UI indicators
    const [shieldCooldown, setShieldCooldown] = useState(false);
    const [attackCooldown, setAttackCooldown] = useState(false);

    // Cooldown configurations (in milliseconds)
    const SHIELD_COOLDOWN_TIME = 1000;
    const ATTACK_COOLDOWN_TIME = 300;

    const joystickRef = useRef({
        active: false,
        pointerId: -1,
        originX: 0,
        originY: 0,
        x: 0,
        y: 0,
    });

    // Added placeholders for action states
    const sendRef = useRef({ 
        dx: 0, 
        dy: 0,
        shield: false,
        attack: false 
    });

    useEffect(() => {
        const socket = io("http://localhost:3001");
        socketRef.current = socket;

        const interval = setInterval(() => {
            socket.emit("input", sendRef.current);
            
        }, 50); // 20 updates/sec

        return () => {
            clearInterval(interval);
            socket.disconnect();
        };
    }, []);

    // --- Action Handlers ---
    const handleShieldClick = () => {
        if (shieldCooldown) return;

        sendRef.current.shield = true;
        console.log("Shield triggered");

        setShieldCooldown(true);
        setTimeout(() => {
            setShieldCooldown(false);

            sendRef.current.shield = false; 
        }, SHIELD_COOLDOWN_TIME);
    };

    const handleAttackClick = () => {
        if (attackCooldown) return;

        sendRef.current.attack = true;

        setAttackCooldown(true);
        setTimeout(() => {
            setAttackCooldown(false);
            sendRef.current.attack = false;
        }, ATTACK_COOLDOWN_TIME);
    };

    // --- Joystick Helpers ---
    function clampJoystick(dx: number, dy: number, max: number) {
        const dist = Math.hypot(dx, dy);
        if (dist <= max) return { dx, dy };

        const scale = max / dist;
        return { dx: dx * scale, dy: dy * scale };
    }

    function onPointerDown(e: React.PointerEvent) {
        // Prevent registering joystick movement if clicking a button
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

        setKnob({
            x: clamped.dx,
            y: clamped.dy,
        });

        sendRef.current = {
            ...sendRef.current,
            dx: clamped.dx / MAX,
            dy: clamped.dy / MAX,
        };
    }

    function onPointerUp(e: React.PointerEvent) {
        if (e.pointerId !== joystickRef.current.pointerId) return;

        joystickRef.current.active = false;

        setKnob({ x: 0, y: 0 });
        sendRef.current = { 
            ...sendRef.current,
            dx: 0, 
            dy: 0 
        };
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

            {/* Controls Container (Houses buttons stacked cleanly over the joystick) */}
            <div
                style={{
                    position: "absolute",
                    bottom: 60,
                    left: 60,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "20px"
                }}
            >
                {/* Action Buttons Zone */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "140px" }}>
                    <button
                        onClick={handleShieldClick}
                        disabled={shieldCooldown}
                        style={{
                            padding: "12px",
                            borderRadius: "8px",
                            border: "none",
                            background: shieldCooldown ? "#333" : "#00bcd4",
                            color: shieldCooldown ? "#666" : "#fff",
                            fontWeight: "bold",
                            cursor: shieldCooldown ? "not-allowed" : "pointer",
                            transition: "background 0.2s",
                            opacity: shieldCooldown ? 0.6 : 1,
                        }}
                    >
                        {shieldCooldown ? "SHIELD [CD]" : "SHIELD"}
                    </button>

                    <button
                        onClick={handleAttackClick}
                        disabled={attackCooldown}
                        style={{
                            padding: "12px",
                            borderRadius: "8px",
                            border: "none",
                            background: attackCooldown ? "#333" : "#f44336",
                            color: attackCooldown ? "#666" : "#fff",
                            fontWeight: "bold",
                            cursor: attackCooldown ? "not-allowed" : "pointer",
                            transition: "background 0.2s",
                            opacity: attackCooldown ? 0.6 : 1,
                        }}
                    >
                        {attackCooldown ? "ATTACK [CD]" : "ATTACK"}
                    </button>
                </div>

                {/* Joystick Wrapper */}
                <div
                    style={{
                        width: 140,
                        height: 140,
                        position: "relative"
                    }}
                >
                    {/* Base */}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.08)",
                            border: "2px solid rgba(255,255,255,0.2)",
                        }}
                    />

                    {/* Knob */}
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
        </div>
    );
}