"use client";

/**
 * =============================================================================
 *  /controller
 * -----------------------------------------------------------------------------
 *  This is the page a player loads on their PHONE. It is the input device for
 *  a separate, larger display running /host (see app/host/page.tsx).
 *
 *  Flow:
 *    1. "name" phase       - player types a display name and hits Join.
 *                            Submitting is also the user-gesture iOS needs
 *                            before it will grant motion/orientation access,
 *                            so we request that permission right here.
 *    2. "connecting" phase - socket opens, we emit "join" with the name and
 *                            wait for the server to confirm.
 *    3. "playing" phase    - server replied "joined" with a randomly-assigned
 *                            spawn position. The joystick + canvas are now
 *                            live and sending input to the server.
 *
 *  Authority model:
 *    The server (server/index.js) owns position. This page NEVER moves the
 *    player locally - it only ever sends *intent* via "input" events
 *    ({ dx, dy }, a unit-length direction vector) and then mirrors back
 *    whatever position the server broadcasts in "state". This is what makes
 *    it safe for many phones to be on /controller at once: each socket gets
 *    its own entry in the server's player map, keyed by socket.id, so there
 *    is nothing controller-side that needs to know about other players.
 *
 *  Known TODOs (left over from the prototype this was built from):
 *    - Keyboard input (WASD) is captured into the `keys` map below but never
 *      actually applied to movement. Left in as a hook for a future desktop
 *      testing mode - wire it into the `dx`/`dy` calculation in loop() if
 *      you want that.
 *    - Shield/attack gestures are detected locally (see gyroAndAccelHandler)
 *      but not yet emitted to the server - the server has no handler for
 *      them. Search "TODO: BACKEND" below for the exact spots to wire up
 *      once server/index.js grows "shield" / "attack" events.
 * =============================================================================
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";

/* -----------------------------------------------------------------------------
 * Tunables - keep these in sync with server/index.js (WORLD_WIDTH, PLAYER_SPEED)
 * and app/host/page.tsx (PLAYER_SIZE) if you change them.
 * -------------------------------------------------------------------------- */
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000;

const ATTACK_COOLDOWN_TIME = 4;
const SHIELD_COOLDOWN_TIME = 3;

const SHIELD_BETA_THRESHOLD = 10;
const SHIELD_Y_THRESHOLD = 80;
const SHIELD_DURATION = 3000;

const ATTACK_ACCEL_THRESHOLD = 8;

const BROADCAST_INTERVAL_MS = 100; // how often we send "input" to the server
const DEBUG_REFRESH_MS = 100;
const MAX_NAME_LENGTH = 20; // must match the server's name truncation

// Falls back to localhost:3001 for local same-machine dev. When testing on
// a real phone (or tunneling the Next app through ngrok/similar), this MUST
// be set to a publicly-reachable URL for the socket server - "localhost" on
// a phone means the phone itself, not your dev machine. See README.md for
// the ngrok setup.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

/* -----------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */
type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

// Shape the server emits in its "state" broadcast (see server/index.js).
type ServerPlayer = { id: string; name: string; x: number; y: number; dx: number; dy: number };

type Phase = "name" | "connecting" | "playing";

type DebugSnapshot = {
  orientation: Orientation | null;
  motion: Motion | null;
  alphaDelta: number;
  betaDelta: number;
  gammaDelta: number;
  accelXDelta: number;
  accelYDelta: number;
  accelZDelta: number;
  attackMagnitude: number;
  attackDirection: number | null;
  attackVectorX: number;
  attackVectorY: number;
  attackTriggered: boolean;
  shieldActive: boolean;
  lastTrigger: number | null;
  fps: number;
  playerUuid: string | null;
  playerName: string | null;
  localPos: { x: number; y: number };
};

const EMPTY_DEBUG: DebugSnapshot = {
  orientation: null,
  motion: null,
  alphaDelta: 0,
  betaDelta: 0,
  gammaDelta: 0,
  accelXDelta: 0,
  accelYDelta: 0,
  accelZDelta: 0,
  attackMagnitude: 0,
  attackDirection: null,
  attackVectorX: 0,
  attackVectorY: 0,
  attackTriggered: false,
  shieldActive: false,
  lastTrigger: null,
  fps: 0,
  playerUuid: null,
  playerName: null,
  localPos: { x: 0, y: 0 },
};

function fmt(n: number | undefined | null, digits = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function normalizeRadians(angle: number) {
  const tau = Math.PI * 2;
  const wrapped = ((angle + Math.PI) % tau + tau) % tau;
  return wrapped - Math.PI;
}

export default function ControllerPage() {
  /* ---- Join flow state ---- */
  const [phase, setPhase] = useState<Phase>("name");
  const [nameInput, setNameInput] = useState("");
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  /* ---- Game UI refs ---- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);

  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugSnapshot>(EMPTY_DEBUG);

  /**
   * Step 1: name entry + sensor permission.
   *
   * Submitting the form is the "user gesture" iOS Safari requires before it
   * will let us call DeviceOrientationEvent.requestPermission() /
   * DeviceMotionEvent.requestPermission() - calling these on page load
   * (outside a click/submit handler) silently fails on iOS, so don't move
   * this earlier in the flow.
   */
  async function handleSubmitName(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) return;

    setJoinError(null);

    try {
      const OrientationCtor = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof OrientationCtor?.requestPermission === "function") {
        const result = await OrientationCtor.requestPermission();
        if (result !== "granted") {
          setJoinError("Motion access was denied. Allow it in Settings to play.");
          return;
        }
      }

      const MotionCtor = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof MotionCtor?.requestPermission === "function") {
        await MotionCtor.requestPermission();
      }
      // Android / desktop browsers don't implement requestPermission at all,
      // so the typeof checks above just skip straight past them - no
      // permission prompt needed there.
    } catch {
      setJoinError("Motion access was denied. Allow it in Settings to play.");
      return;
    }

    setPhase("connecting");
    setPlayerName(trimmed); // triggers the effect below, which owns the socket
  }

  /**
   * Step 2 + 3: connect, join, play.
   *
   * Runs once, right after a name is confirmed. Owns the socket, the sensor
   * listeners, the canvas/joystick UI, and the render loop for the rest of
   * this component's life. Everything inside is plain DOM/canvas code (not
   * React state) for performance - React state is only touched via the
   * throttled debug snapshot near the bottom.
   */
  useEffect(() => {
    if (!playerName) return;

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    let width = window.innerWidth;
    let height = window.innerHeight;

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.style.touchAction = "none";

    const keys: Record<string, boolean> = {}; // captured but not yet applied - see file header TODO
    const touchInput = {
      active: false,
      pointerId: -1,
      originX: 0,
      originY: 0,
      x: 0,
      y: 0,
    };

    const localPlayer = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
    };

    /* ---- Socket + join handshake ---- */
    // extraHeaders is needed if SOCKET_URL is an ngrok free-tier URL: ngrok
    // shows an HTML interstitial warning to first-time visitors, which
    // breaks the socket.io polling handshake unless this header is sent.
    // Server must allow this header in its CORS config (see server/index.js).
    const socket: Socket = io(SOCKET_URL, {
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
    });
    let selfId: string | null = null;

    socket.on("connect", () => {
      selfId = socket.id ?? null;
      // The server has no idea who we are yet - this is what actually
      // creates our player and assigns a random spawn position server-side.
      socket.emit("join", { name: playerName });
    });

    socket.on("joined", (payload: { id: string; name: string; x: number; y: number }) => {
      localPlayer.x = payload.x;
      localPlayer.y = payload.y;
      setPhase("playing");
    });

    socket.on("join-error", (payload: { message: string }) => {
      setJoinError(payload?.message || "Could not join the game.");
      setPhase("name");
      setPlayerName(null); // unmounts this effect; player retypes their name
    });

    socket.on("disconnect", () => {
      setPhase("name");
      setPlayerName(null);
      setJoinError("Disconnected from server. Enter your name to rejoin.");
    });

    const players: Record<
      string,
      { x: number; y: number; dx: number; dy: number; lastUpdate: number }
    > = {};

    // Server is authoritative on position (it integrates dx/dy server-side in
    // its own tick loop), so we just mirror whatever it broadcasts.
    socket.on("state", (payload: { players: ServerPlayer[] }) => {
      const now = performance.now();
      const liveIds = new Set<string>();

      for (const p of payload.players) {
        liveIds.add(p.id);

        if (p.id === selfId) {
          localPlayer.x = p.x;
          localPlayer.y = p.y;
          continue;
        }

        players[p.id] = { x: p.x, y: p.y, dx: p.dx, dy: p.dy, lastUpdate: now };
      }

      for (const id of Object.keys(players)) {
        if (!liveIds.has(id)) delete players[id];
      }
    });

    /* ---- Sensors ----
     * In the prototype this was built from, orientation/motion arrived as
     * props from an unseen parent. Now that this page owns the whole flow,
     * it listens directly. */
    let orientation: Orientation | null = null;
    let motion: Motion | null = null;

    function handleOrientation(e: DeviceOrientationEvent) {
      orientation = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
    }
    function handleMotion(e: DeviceMotionEvent) {
      const accel = e.accelerationIncludingGravity ?? e.acceleration;
      if (!accel) return;
      motion = { x: accel.x ?? 0, y: accel.y ?? 0, z: accel.z ?? 0 };
    }
    window.addEventListener("deviceorientation", handleOrientation);
    window.addEventListener("devicemotion", handleMotion);

    function keyDown(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = true;
    }
    function keyUp(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = false;
    }

    /* ---- Joystick ---- */
    function showJoystick(x: number, y: number) {
      const base = joystickBaseRef.current;
      const knob = joystickKnobRef.current;
      if (!base || !knob) return;

      base.style.left = `${x}px`;
      base.style.top = `${y}px`;
      base.style.opacity = "1";

      knob.style.left = `${x}px`;
      knob.style.top = `${y}px`;
      knob.style.opacity = "1";
    }

    function moveJoystickKnob(originX: number, originY: number, x: number, y: number) {
      const knob = joystickKnobRef.current;
      if (!knob) return;

      const knobDx = x - originX;
      const knobDy = y - originY;
      const knobDist = Math.hypot(knobDx, knobDy);
      const clamped = Math.min(knobDist, maxTouchDistance);
      const angle = Math.atan2(knobDy, knobDx);

      knob.style.left = `${originX + Math.cos(angle) * clamped}px`;
      knob.style.top = `${originY + Math.sin(angle) * clamped}px`;
    }

    function hideJoystick() {
      const base = joystickBaseRef.current;
      const knob = joystickKnobRef.current;
      if (!base || !knob) return;

      base.style.opacity = "0";
      knob.style.opacity = "0";
    }

    function updateTouchInput(e: PointerEvent) {
      if (!touchInput.active || e.pointerId !== touchInput.pointerId) return;

      touchInput.x = e.clientX;
      touchInput.y = e.clientY;

      moveJoystickKnob(touchInput.originX, touchInput.originY, touchInput.x, touchInput.y);
    }

    function startTouchInput(e: PointerEvent) {
      if (e.pointerType !== "touch" || touchInput.active) return;

      touchInput.active = true;
      touchInput.pointerId = e.pointerId;
      touchInput.originX = e.clientX;
      touchInput.originY = e.clientY;
      touchInput.x = e.clientX;
      touchInput.y = e.clientY;

      canvas.setPointerCapture(e.pointerId);
      showJoystick(e.clientX, e.clientY);
    }

    function endTouchInput(e: PointerEvent) {
      if (e.pointerId !== touchInput.pointerId) return;

      canvas.releasePointerCapture(e.pointerId);
      touchInput.active = false;
      touchInput.pointerId = -1;

      hideJoystick();
    }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointerdown", startTouchInput);
    canvas.addEventListener("pointermove", updateTouchInput);
    canvas.addEventListener("pointerup", endTouchInput);
    canvas.addEventListener("pointercancel", endTouchInput);

    let last = performance.now();
    let lastBroadcast = 0;
    const maxTouchDistance = 90;
    const touchDeadzone = 8;

    let prevAlpha: number | null = null;
    let prevBeta: number | null = null;
    let prevGamma: number | null = null;
    let prevMotionX: number | null = null;
    let prevMotionY: number | null = null;
    let prevMotionZ: number | null = null;
    let shieldTimer: ReturnType<typeof setTimeout> | null = null;

    const debugStats = {
      alphaDelta: 0,
      betaDelta: 0,
      gammaDelta: 0,
      accelXDelta: 0,
      accelYDelta: 0,
      accelZDelta: 0,
      attackMagnitude: 0,
      attackDirection: null as number | null,
      attackVectorX: 0,
      attackVectorY: 0,
      attackTriggered: false,
      shieldActive: false,
      lastTrigger: null as number | null,
      fps: 0,
    };

    /* ---- Gesture detection (shield + attack) ----
     * Purely local for now - see file header TODO for wiring this to the
     * server once it grows "shield" / "attack" handlers. */
    function gyroAndAccelHandler() {
      if (!orientation || !motion) return;

      const motionDeltaX = prevMotionX !== null ? motion.x - prevMotionX : 0;
      const motionDeltaY = prevMotionY !== null ? motion.y - prevMotionY : 0;
      const motionDeltaZ = prevMotionZ !== null ? motion.z - prevMotionZ : 0;

      if (
        prevAlpha !== null &&
        prevBeta !== null &&
        prevGamma !== null &&
        prevMotionX !== null &&
        prevMotionY !== null &&
        prevMotionZ !== null
      ) {
        const alphaDelta = Math.abs(orientation.alpha - prevAlpha);
        const betaDelta = Math.abs(orientation.beta - prevBeta);
        const gammaDelta = Math.abs(orientation.gamma - prevGamma);
        const accelXDelta = Math.abs(motionDeltaX);
        const accelYDelta = Math.abs(motionDeltaY);
        const accelZDelta = Math.abs(motionDeltaZ);

        debugStats.alphaDelta = alphaDelta;
        debugStats.betaDelta = betaDelta;
        debugStats.gammaDelta = gammaDelta;
        debugStats.accelXDelta = accelXDelta;
        debugStats.accelYDelta = accelYDelta;
        debugStats.accelZDelta = accelZDelta;
        debugStats.attackTriggered = false;

        if (betaDelta >= SHIELD_BETA_THRESHOLD && accelZDelta >= SHIELD_Y_THRESHOLD) {
          if (shieldTimer) clearTimeout(shieldTimer);

          // TODO: BACKEND - server/index.js has no "shield" handler yet.
          // Once it does: socket.emit("shield", { active: true });
          debugStats.shieldActive = true;
          debugStats.lastTrigger = performance.now();

          shieldTimer = setTimeout(() => {
            // TODO: BACKEND - socket.emit("shield", { active: false });
            shieldTimer = null;
            debugStats.shieldActive = false;
          }, SHIELD_DURATION);
        } else {
          const attackMagnitude = Math.hypot(motionDeltaX, motionDeltaY, motionDeltaZ);
          debugStats.attackMagnitude = attackMagnitude;

          if (attackMagnitude >= ATTACK_ACCEL_THRESHOLD) {
            const alphaRadians = orientation.alpha * (Math.PI / 180);
            const gyroX = Math.sin(orientation.gamma * (Math.PI / 180));
            const gyroY = Math.sin(orientation.beta * (Math.PI / 180));
            const attackVectorX = motionDeltaX + gyroX;
            const attackVectorY = motionDeltaY + gyroY;
            const attackDirection = normalizeRadians(
              Math.atan2(attackVectorY, attackVectorX) + alphaRadians
            );
            debugStats.attackDirection = attackDirection;
            debugStats.attackVectorX = attackVectorX;
            debugStats.attackVectorY = attackVectorY;
            debugStats.attackTriggered = true;

            // TODO: BACKEND - server/index.js has no "attack" handler yet.
            // Once it does:
            //   socket.emit("attack", {
            //     origin: { x: localPlayer.x, y: localPlayer.y },
            //     timestamp: Date.now(),
            //     direction: attackDirection,
            //   });

            return;
          }
        }
      }

      prevAlpha = orientation.alpha;
      prevBeta = orientation.beta;
      prevGamma = orientation.gamma;
      prevMotionX = motion.x;
      prevMotionY = motion.y;
      prevMotionZ = motion.z;
    }

    let rafId: number;
    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

      if (dt > 0) {
        const instantFps = 1 / dt;
        debugStats.fps = debugStats.fps ? debugStats.fps * 0.9 + instantFps * 0.1 : instantFps;
      }

      let dx = 0;
      let dy = 0;

      if (touchInput.active) {
        const touchDx = touchInput.x - touchInput.originX;
        const touchDy = touchInput.y - touchInput.originY;
        const touchDistance = Math.hypot(touchDx, touchDy);

        if (touchDistance > touchDeadzone) {
          const touchStrength = Math.min(
            1,
            (touchDistance - touchDeadzone) / (maxTouchDistance - touchDeadzone)
          );

          dx += (touchDx / touchDistance) * touchStrength;
          dy += (touchDy / touchDistance) * touchStrength;
        }
      }

      // normalized movement
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
      }

      // Send our input to the server at a throttled rate. Harmless to send
      // before "joined" arrives - the server just ignores input from
      // sockets it doesn't recognize as players yet.
      if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
        socket.emit("input", { dx, dy });
        lastBroadcast = now;
      }

      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, width, height);

      gyroAndAccelHandler();

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    // Periodically push a snapshot of the live sensor/game values into React
    // state so the debug overlay can render them without forcing a
    // re-render on every animation frame.
    const debugInterval = setInterval(() => {
      setDebugData({
        orientation,
        motion,
        alphaDelta: debugStats.alphaDelta,
        betaDelta: debugStats.betaDelta,
        gammaDelta: debugStats.gammaDelta,
        accelXDelta: debugStats.accelXDelta,
        accelYDelta: debugStats.accelYDelta,
        accelZDelta: debugStats.accelZDelta,
        attackMagnitude: debugStats.attackMagnitude,
        attackDirection: debugStats.attackDirection,
        attackVectorX: debugStats.attackVectorX,
        attackVectorY: debugStats.attackVectorY,
        attackTriggered: debugStats.attackTriggered,
        shieldActive: debugStats.shieldActive,
        lastTrigger: debugStats.lastTrigger,
        fps: debugStats.fps,
        playerUuid: selfId,
        playerName,
        localPos: { x: localPlayer.x, y: localPlayer.y },
      });
    }, DEBUG_REFRESH_MS);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("devicemotion", handleMotion);
      canvas.removeEventListener("pointerdown", startTouchInput);
      canvas.removeEventListener("pointermove", updateTouchInput);
      canvas.removeEventListener("pointerup", endTouchInput);
      canvas.removeEventListener("pointercancel", endTouchInput);
      if (shieldTimer) clearTimeout(shieldTimer);
      clearInterval(debugInterval);
      socket.disconnect();
    };
  }, [playerName]);

  return (
    <>
      {phase === "name" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            background: "#181818",
            padding: 24,
          }}
        >
          <div
            style={{
              color: "#e2e8f0",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: 0.6,
            }}
          >
            Enter the arena
          </div>
          <form
            onSubmit={handleSubmitName}
            style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}
          >
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "14px 16px",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 16,
                color: "#e2e8f0",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              style={{
                padding: "14px 16px",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 14,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "#181818",
                background: nameInput.trim() ? "#9ae6b4" : "#4a5568",
                border: "none",
                borderRadius: 8,
                cursor: nameInput.trim() ? "pointer" : "not-allowed",
              }}
            >
              Join
            </button>
            {joinError && (
              <div
                style={{
                  color: "#fc8181",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontSize: 12,
                }}
              >
                {joinError}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Canvas + joystick render as soon as a name is confirmed (even while
          still "connecting") so canvasRef exists before the effect above
          runs. A translucent overlay covers it until "joined" arrives. */}
      {playerName && (
        <>
          <canvas
            ref={canvasRef}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              width: "100vw",
              height: "100vh",
              display: "block",
              userSelect: "none",
              WebkitUserSelect: "none",
              touchAction: "none",
              WebkitTouchCallout: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          />

          <div
            ref={joystickBaseRef}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              border: "2px solid rgba(255,255,255,0.2)",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              opacity: 0,
              transition: "opacity 0.12s ease-out",
              zIndex: 500,
            }}
          />
          <div
            ref={joystickKnobRef}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "white",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              opacity: 0,
              transition: "opacity 0.12s ease-out",
              zIndex: 501,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 16,
              left: 16,
              zIndex: 900,
              padding: "8px 14px",
              background: "rgba(24, 24, 24, 0.75)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              color: "#e2e8f0",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600 }}>{playerName}</div>
          </div>

          <button
            onClick={() => setDebugOpen((open) => !open)}
            style={{
              position: "fixed",
              left: 16,
              bottom: 16,
              zIndex: 1000,
              padding: "8px 14px",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: 12,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: debugOpen ? "#181818" : "#9ae6b4",
              background: debugOpen ? "#9ae6b4" : "rgba(24, 24, 24, 0.85)",
              border: "1px solid #9ae6b4",
              borderRadius: 6,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            {debugOpen ? "Close Debug" : "Debug"}
          </button>

          {debugOpen && (
            <div
              style={{
                position: "fixed",
                left: 16,
                bottom: 60,
                zIndex: 999,
                width: 240,
                maxHeight: "60vh",
                overflowY: "auto",
                padding: "12px 14px",
                background: "rgba(20, 20, 20, 0.9)",
                border: "1px solid #333",
                borderRadius: 8,
                color: "#e2e8f0",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 11,
                lineHeight: 1.6,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <div style={{ color: "#9ae6b4", marginBottom: 6, fontSize: 12 }}>SENSOR DEBUG</div>

              <div style={{ color: "#718096", marginTop: 6 }}>ORIENTATION</div>
              <div>alpha: {fmt(debugData.orientation?.alpha)}</div>
              <div>beta: {fmt(debugData.orientation?.beta)}</div>
              <div>gamma: {fmt(debugData.orientation?.gamma)}</div>

              <div style={{ color: "#718096", marginTop: 6 }}>MOTION (accel)</div>
              <div>x: {fmt(debugData.motion?.x)}</div>
              <div>y: {fmt(debugData.motion?.y)}</div>
              <div>z: {fmt(debugData.motion?.z)}</div>

              <div style={{ color: "#718096", marginTop: 6 }}>ATTACK DETECTION</div>
              <div>magnitude: {fmt(debugData.attackMagnitude)}</div>
              <div>
                direction:{" "}
                {debugData.attackDirection === null ? "—" : `${fmt(debugData.attackDirection, 3)} rad`}
              </div>
              <div>fired: {debugData.attackTriggered ? "YES" : "no"}</div>

              <div style={{ color: "#718096", marginTop: 6 }}>SHIELD DETECTION</div>
              <div>
                shield:{" "}
                <span style={{ color: debugData.shieldActive ? "#9ae6b4" : "#718096" }}>
                  {debugData.shieldActive ? "ACTIVE" : "idle"}
                </span>
              </div>

              <div style={{ color: "#718096", marginTop: 6 }}>GAME</div>
              <div>fps: {fmt(debugData.fps, 0)}</div>
              <div>uuid: {debugData.playerUuid ? `${debugData.playerUuid.slice(0, 8)}…` : "—"}</div>
              <div>
                pos: ({fmt(debugData.localPos.x, 0)}, {fmt(debugData.localPos.y, 0)})
              </div>
            </div>
          )}

          {phase === "connecting" && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1500,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(24, 24, 24, 0.85)",
                color: "#9ae6b4",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 13,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Joining…
            </div>
          )}
        </>
      )}
    </>
  );
}