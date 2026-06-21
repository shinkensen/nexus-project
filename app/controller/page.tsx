"use client";

import { useState, useEffect, useRef } from "react";
import { useDeviceMotion } from "../hooks/useDeviceMotion";


function clampJoystick(dx: number, dy: number, max: number) {
    const dist = Math.hypot(dx, dy);
    if (dist <= max) return { dx, dy };
    const scale = max / dist;
    return { dx: dx * scale, dy: dy * scale };
}

// phone controls

const SHIELD_BETA_THRESHOLD = 60;
const SHIELD_DURATION = 3000;
const SHIELD_COOLDOWN_TIME = 1000;
const SHIELD_MOVE_SPEED_MULTIPLIER = 0.4; // movement speed while shield is up

const ATTACK_THRESHOLD = 7;
const ATTACK_COOLDOWN_TIME = 300;
const GYRO_POLL_MS = 50;

const MOTION_DETECTION_TIMEOUT_MS = 1500;


// The instruction images double as the tap targets for attack/shield.
// This covers players without motion controls, and also gives motion-control
// players a manual fallback for the same actions.
function ActionImageButtons({
    shieldActive,
    shieldCooldown,
    attackCooldown,
    onAttack,
    onShield,
}: {
    shieldActive: boolean;
    shieldCooldown: boolean;
    attackCooldown: boolean;
    onAttack: () => void;
    onShield: () => void;
}) {
    const attackDisabled = attackCooldown || shieldActive;
    // Shield button stays tappable while active so the player can cancel it early.
    const shieldDisabled = !shieldActive && shieldCooldown;

    return (
        <div
            style={{
                position: "absolute",
                bottom: 40,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
                gap: "16px",
                zIndex: 10,
            }}
        >
            <button
                onClick={onAttack}
                disabled={attackDisabled}
                aria-label="Attack"
                style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: attackDisabled ? "not-allowed" : "pointer",
                }}
            >
                <img
                    src="/assets/ui/stab_ins.png"
                    alt="push phone toward right direction"
                    style={{
                        width: 120,
                        height: 120,
                        borderRadius: "10px",
                        objectFit: "contain",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        opacity: attackDisabled ? 0.35 : 1,
                        filter: attackDisabled ? "grayscale(1)" : "none",
                        transition: "opacity 0.15s, filter 0.15s",
                    }}
                />
            </button>

            <button
                onClick={onShield}
                disabled={shieldDisabled}
                aria-label="Shield"
                style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: shieldDisabled ? "not-allowed" : "pointer",
                }}
            >
                <img
                    src="/assets/ui/shield_ins.png"
                    alt="SLAM to shield"
                    style={{
                        width: 120,
                        height: 120,
                        borderRadius: "10px",
                        objectFit: "contain",
                        background: shieldActive ? "rgba(0,188,212,0.18)" : "rgba(255,255,255,0.05)",
                        border: shieldActive
                            ? "1px solid rgba(0,188,212,0.8)"
                            : "1px solid rgba(255,255,255,0.15)",
                        opacity: shieldDisabled ? 0.35 : 1,
                        filter: shieldDisabled ? "grayscale(1)" : "none",
                        transition: "opacity 0.15s, filter 0.15s, background 0.15s, border 0.15s",
                    }}
                />
            </button>
        </div>
    );
}


export default function Controller() {
    const [name, setName] = useState("");
    const [joined, setJoined] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const [shieldActive, setShieldActive] = useState(false);
    const [shieldCooldown, setShieldCooldown] = useState(false);
    const [attackCooldown, setAttackCooldown] = useState(false);
    const channelRef = useRef<any>(null);
    const shieldActiveRef = useRef(false);

    const [motionAvailable, setMotionAvailable] = useState<boolean | null>(null);

    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const joystickRef = useRef({
        active: false,
        pointerId: -1,
        originX: 0,
        originY: 0,
        angleRef: 0,
    });

    const { orientation, motion, permissionNeeded, requestPermission } = useDeviceMotion();

    useEffect(() => {
        if (permissionNeeded) {
            requestPermission()
                .then((result: any) => {
                    if (result === "denied" || result === false) {
                        setMotionAvailable(false);
                    }
                })
                .catch(() => setMotionAvailable(false));
        }
    }, [permissionNeeded, requestPermission]);

    useEffect(() => {
        if (motionAvailable !== null) return; // already decided

        if (orientation && motion) {
            setMotionAvailable(true);
            return;
        }

        const timeout = setTimeout(() => {
            setMotionAvailable((prev) => (prev === null ? false : prev));
        }, MOTION_DETECTION_TIMEOUT_MS);

        return () => clearTimeout(timeout);
    }, [orientation, motion, motionAvailable]);

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
    const shieldCooldownRef = useRef(false);
    const shieldCooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attackCooldownRef = useRef(false);

    useEffect(() => {
        shieldActiveRef.current = shieldActive;
    }, [shieldActive]);

    function startShieldCooldown() {
        shieldCooldownRef.current = true;
        setShieldCooldown(true);

        shieldCooldownTimeoutRef.current = setTimeout(() => {
            shieldCooldownRef.current = false;
            setShieldCooldown(false);
            shieldCooldownTimeoutRef.current = null;
        }, SHIELD_COOLDOWN_TIME);
    }

    function triggerShield() {
        if (!channelRef.current) return;
        if (shieldTimeoutRef.current) return;
        if (shieldCooldownRef.current) return;

        channelRef.current.emit("shield", { shield: true });
        setShieldActive(true);

        shieldTimeoutRef.current = setTimeout(() => {
            channelRef.current?.emit("shield", { shield: false });
            setShieldActive(false);
            shieldTimeoutRef.current = null;
            startShieldCooldown();
        }, SHIELD_DURATION);
    }

    function handleManualShieldToggle() {
        if (shieldActive) {
            if (shieldTimeoutRef.current) {
                clearTimeout(shieldTimeoutRef.current);
                shieldTimeoutRef.current = null;
            }
            channelRef.current?.emit("shield", { shield: false });
            setShieldActive(false);
            startShieldCooldown();
        } else {
            triggerShield();
        }
    }

    function triggerAttack() {
        if (!channelRef.current) return;
        if (shieldTimeoutRef.current) return; // can't attack w/ shield on
        if (attackCooldownRef.current) return;

        channelRef.current.emit("attack");
        attackCooldownRef.current = true;
        setAttackCooldown(true);

        setTimeout(() => {
            attackCooldownRef.current = false;
            setAttackCooldown(false);
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
            const gammaDelta = Math.abs(currentOrientation.gamma - prev.gamma);
            const motionDeltaX = currentMotion.x - prev.motionX;
            const motionDeltaZ = currentMotion.z - prev.motionZ;
            const motionDeltaY = currentMotion.y - prev.motionY;
            const accelZDelta = Math.abs(motionDeltaZ);
            const accelYDelta = Math.abs(motionDeltaY);
            
            if (betaDelta <= 8 && accelZDelta > ATTACK_THRESHOLD) {
                triggerAttack();
            }
            else if (gammaDelta >= SHIELD_BETA_THRESHOLD) {
                triggerShield();
            }
        } 

        prev.alpha = currentOrientation.alpha;
        prev.beta = currentOrientation.beta;
        prev.gamma = currentOrientation.gamma;
        prev.motionX = currentMotion.x;
        prev.motionY = currentMotion.y;
        prev.motionZ = currentMotion.z;
    }

    useEffect(() => {
        if (!joined || !motionAvailable) return;

        const gyroInterval = setInterval(gyroAndAccelHandler, GYRO_POLL_MS);
        return () => clearInterval(gyroInterval);
    }, [joined, motionAvailable]);

    useEffect(() => {
        return () => {
            if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
            if (shieldCooldownTimeoutRef.current) clearTimeout(shieldCooldownTimeoutRef.current);
        };
    }, []);

    const sendRef = useRef({ dx: 0, dy: 0 });
    const angleRef = useRef(0);

    useEffect(() => {
        if (!joined) return;

        const interval = setInterval(() => {
            const { dx, dy } = sendRef.current;
            const speedMultiplier = shieldActiveRef.current ? SHIELD_MOVE_SPEED_MULTIPLIER : 1;
            channelRef.current?.emit("input", { dx: dx * speedMultiplier, dy: dy * speedMultiplier });
        }, 50); // 20 updates/sec

        return () => clearInterval(interval);
    }, [joined]);

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

            {motionAvailable !== null && (
                <ActionImageButtons
                    shieldActive={shieldActive}
                    shieldCooldown={shieldCooldown}
                    attackCooldown={attackCooldown}
                    onAttack={triggerAttack}
                    onShield={handleManualShieldToggle}
                />
            )}

            <div
                style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 140,
                    height: 140,
                    transform: "translate(-50%, -50%)",
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