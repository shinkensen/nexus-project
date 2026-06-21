"use client";

import { useState, useEffect, useRef } from "react";
import { useDeviceMotion } from "../hooks/useDeviceMotion";

// ─── Joystick helpers ────────────────────────────────────────────────────────

function clampJoystick(dx: number, dy: number, max: number) {
    const dist = Math.hypot(dx, dy);
    if (dist <= max) return { dx, dy };
    const scale = max / dist;
    return { dx: dx * scale, dy: dy * scale };
}

// phone controls

const SHIELD_BETA_THRESHOLD = 6;
const SHIELD_Z_THRESHOLD = 60;
const SHIELD_DURATION = 3000;

const ATTACK_THRESHOLD = 8;
const ATTACK_COOLDOWN_TIME = 300;
const GYRO_POLL_MS = 50;

// ─── Main Controller ──────────────────────────────────────────────────────────

export default function Controller() {
    const [name, setName] = useState("");
    const [joined, setJoined] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const [shieldActive, setShieldActive] = useState(false);
    const channelRef = useRef<any>(null);

    // Joystick state
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const joystickRef = useRef({
        active: false,
        pointerId: -1,
        originX: 0,
        originY: 0,
        angleRef: 0,
    });

    const { orientation, motion, permissionNeeded, requestPermission } = useDeviceMotion();

    // Request motion/orientation permission once, as a side effect (not during render)
    useEffect(() => {
        if (permissionNeeded) {
            requestPermission();
        }
    }, [permissionNeeded, requestPermission]);

    // Keep latest sensor readings available to the polling loop without
    // re-subscribing the interval on every sensor update.
    const debugRef = useRef<{ orientation: any; motion: any }>({ orientation: null, motion: null });
    useEffect(() => {
        debugRef.current = { orientation, motion };
    }, [orientation, motion]);

    const prevRef = useRef({
        alpha: null as number | null,
        beta: null as number | null,
        gamma: null as number | null,
        motionX: null as number | null,
        motionY: null as number | null,
        motionZ: null as number | null,
    });

    const shieldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attackCooldownRef = useRef(false);

    function triggerShield() {
        if (!channelRef.current) return;
        if (shieldTimeoutRef.current) return;

        channelRef.current.emit("shield", { shield: true });
        setShieldActive(true);

        shieldTimeoutRef.current = setTimeout(() => {
            channelRef.current?.emit("shield", { shield: false });
            setShieldActive(false);
            shieldTimeoutRef.current = null;
        }, SHIELD_DURATION);
    }

    function triggerAttack(direction: string) {
        if (!channelRef.current) return;
        if (attackCooldownRef.current) return;

        channelRef.current.emit("attack", { direction });
        attackCooldownRef.current = true;

        setTimeout(() => {
            attackCooldownRef.current = false;
        }, ATTACK_COOLDOWN_TIME);
    }

    function gyroAndAccelHandler() {
        const currentOrientation = debugRef.current.orientation;
        const currentMotion = debugRef.current.motion;

        if (!currentOrientation || !currentMotion) return;

        const prev = prevRef.current;

        if (
            prev.alpha !== null &&
            prev.beta !== null &&
            prev.gamma !== null &&
            prev.motionX !== null &&
            prev.motionY !== null &&
            prev.motionZ !== null
        ) {
            const betaDelta = Math.abs(currentOrientation.beta - prev.beta);
            const motionDeltaX = currentMotion.x - prev.motionX;
            const motionDeltaZ = currentMotion.z - prev.motionZ;
            const accelZDelta = Math.abs(motionDeltaZ);

            if (betaDelta >= SHIELD_BETA_THRESHOLD && accelZDelta >= SHIELD_Z_THRESHOLD) {
                triggerShield();
            } else if (betaDelta <= 2) {
                // Phone is roughly flat — check for a directional shake/attack.
                // `direction` is left as a plain string for the backend to parse.
                let direction: string | null = null;

                if (motionDeltaZ > ATTACK_THRESHOLD) {
                    direction = "north";
                } else if (motionDeltaZ < -ATTACK_THRESHOLD) {
                    direction = "south";
                } else if (motionDeltaX > ATTACK_THRESHOLD) {
                    direction = "east";
                } else if (motionDeltaX < -ATTACK_THRESHOLD) {
                    direction = "west";
                }

                if (direction) {
                    triggerAttack(direction);
                }
            }
        }

        prev.alpha = currentOrientation.alpha;
        prev.beta = currentOrientation.beta;
        prev.gamma = currentOrientation.gamma;
        prev.motionX = currentMotion.x;
        prev.motionY = currentMotion.y;
        prev.motionZ = currentMotion.z;
    }

    // Poll the gyro/accel handler on its own interval, independent of the
    // joystick input stream, for as long as we're connected.
    useEffect(() => {
        if (!joined) return;

        const gyroInterval = setInterval(gyroAndAccelHandler, GYRO_POLL_MS);
        return () => clearInterval(gyroInterval);
    }, [joined]);

    // Clean up any pending shield-release timer on unmount.
    useEffect(() => {
        return () => {
            if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
        };
    }, []);

    const sendRef = useRef({ dx: 0, dy: 0 });
    const angleRef = useRef(0);

    // ── Streaming input interval ──────────────────────────────────────────────
    useEffect(() => {
        if (!joined) return;

        const interval = setInterval(() => {
            channelRef.current?.emit("input", sendRef.current);
        }, 50); // 20 updates/sec

        return () => clearInterval(interval);
    }, [joined]);

    // ── Connect via geckos.io ─────────────────────────────────────────────────
    function connectAndJoin(playerName: string) {
        let backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://165.22.144.193";
        if (backendUrl && !backendUrl.startsWith("http://") && !backendUrl.startsWith("https://")) {
            backendUrl = `http://${backendUrl}`;
        }
        const isHttps = backendUrl.startsWith("https://");
        console.log(`[CLIENT LOG] Connecting to ${backendUrl}`);
        setStatusMsg(`Connecting to ${backendUrl}...`);

        import("@geckos.io/client")
            .then((module) => {
                const geckos = module.default;
                const channel = geckos({ url: backendUrl, port: (isHttps ? null : 3001) as number });

                channel.onConnect((error) => {
                    if (error) {
                        console.error("[CLIENT LOG] Connection error:", error);
                        setStatusMsg(`Connection error: ${error.message}`);
                        return;
                    }
                    console.log(`[CLIENT LOG] Connected! ID: ${channel.id}`);
                    channel.emit("join", { name: playerName });
                    channelRef.current = channel;
                    setJoined(true);
                });

                channel.onDisconnect(() => {
                    console.warn("[CLIENT LOG] Disconnected.");
                    setJoined(false);
                    setStatusMsg("Disconnected from server");
                });
            })
            .catch((err) => {
                console.error("[CLIENT LOG] Failed to load geckos client:", err);
                setStatusMsg("Failed to initialize game client package");
            });
    }

    function handleJoin(e: React.FormEvent) {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return;
        connectAndJoin(trimmedName);
    }

    // ── Joystick pointer handlers ─────────────────────────────────────────────

    function onPointerDown(e: React.PointerEvent) {
        if ((e.target as HTMLElement).closest("button")) return;
        joystickRef.current.active = true;
        joystickRef.current.pointerId = e.pointerId;
        joystickRef.current.originX = e.clientX;
        joystickRef.current.originY = e.clientY;
    }

    function onPointerMove(e: React.PointerEvent) {
        if (!joystickRef.current.active || e.pointerId !== joystickRef.current.pointerId) return;

        const rawDx = e.clientX - joystickRef.current.originX;
        const rawDy = e.clientY - joystickRef.current.originY;
        const MAX = 80;
        const clamped = clampJoystick(rawDx, rawDy, MAX);

        setKnob({ x: clamped.dx, y: clamped.dy });

        sendRef.current.dx = clamped.dx / MAX;
        sendRef.current.dy = clamped.dy / MAX;

        // Track angle for attack direction
        const len = Math.hypot(clamped.dx, clamped.dy);
        if (len > 0.01) {
            angleRef.current = Math.atan2(clamped.dy, clamped.dx);
        }
    }

    function onPointerUp(e: React.PointerEvent) {
        if (e.pointerId !== joystickRef.current.pointerId) return;
        joystickRef.current.active = false;
        setKnob({ x: 0, y: 0 });
        sendRef.current.dx = 0;
        sendRef.current.dy = 0;
    }

    // ── Join screen ───────────────────────────────────────────────────────────

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

    // ── In-game controller screen ─────────────────────────────────────────────

    return (
        <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
                height: "100vh",
                background: "radial-gradient(circle at center, #111 0%, #000 100%)",
                touchAction: "none",
                position: "relative",
                overflow: "hidden",
                userSelect: "none",
                fontFamily: "system-ui, sans-serif",
            }}
        >
            {/* Status label */}
            <div style={{ pointerEvents: "none", textAlign: "center", paddingTop: "20px" }}>
                <p style={{ color: "#6366f1", fontSize: "20px", fontWeight: "bold", margin: 0 }}>
                    Connected as {name}
                </p>
                <p style={{ color: "#888", fontSize: "13px", marginTop: "6px" }}>
                    Drag joystick to move • Tilt/shake to shield • Shake flat to attack
                </p>
                {shieldActive && (
                    <p style={{ color: "#00bcd4", fontSize: "14px", fontWeight: "bold", marginTop: "6px" }}>
                        SHIELD ACTIVE
                    </p>
                )}
            </div>

            {/* Joystick */}
            <div
                style={{
                    position: "absolute",
                    bottom: 60,
                    left: 60,
                    width: 140,
                    height: 140,
                }}
            >
                {/* Base ring */}
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
                        transition: joystickRef.current.active ? "none" : "left 0.15s, top 0.15s",
                    }}
                />
            </div>
        </div>
    );
}