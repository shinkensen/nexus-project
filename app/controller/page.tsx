"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000;

const ATTACK_COOLDOWN_TIME = 4;
const SHIELD_COOLDOWN_TIME = 3;

const SHIELD_BETA_THRESHOLD = 10;
const SHIELD_Y_THRESHOLD = 80;
const SHIELD_DURATION = 3000;
const BURN_DURATION = 1000;

const ATTACK_ACCEL_THRESHOLD = 8;

const BROADCAST_INTERVAL_MS = 100;
const DEBUG_REFRESH_MS = 100;

// TODO: BACKEND - hardcoded to match server.js for now (mirrors Controller.tsx).
// Swap for an env var once the server has a real deployment URL.
const SOCKET_URL = "http://localhost:3001";

type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

// Shape the server currently emits in its "state" broadcast (see server.js).
type ServerPlayer = { id: string; x: number; y: number; dx: number; dy: number };

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

export default function Game({
  playerName,
  orientation,
  motion,
}: {
  playerName: string;
  orientation?: Orientation;
  motion?: Motion;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);

  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugSnapshot>(EMPTY_DEBUG);

  const debugRef = useRef({ orientation, motion });
  useEffect(() => {
    debugRef.current = { orientation, motion };
  }, [orientation, motion]);

  useEffect(() => {
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

    const keys: Record<string, boolean> = {};
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

    // Socket.io connection to the local game server (replaces the old Supabase
    // realtime channel). The server assigns our identity as socket.id once
    // "connect" fires, so there's no more client-generated UUID / localStorage
    // lookup needed for "who am I".
    const socket = io(SOCKET_URL);
    let selfId: string | null = null;

    socket.on("connect", () => {
      selfId = socket.id ?? null;
    });

    // TODO: BACKEND - server's createPlayer() in server.js doesn't accept a
    // name yet, so playerName never reaches the server. Once it does, send it
    // here, e.g. socket.emit("join", { name: playerName }).

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

    function keyDown(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = true;
    }

    function keyUp(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = false;
    }

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
      if (!touchInput.active || e.pointerId !== touchInput.pointerId) {
        return;
      }

      touchInput.x = e.clientX;
      touchInput.y = e.clientY;

      moveJoystickKnob(touchInput.originX, touchInput.originY, touchInput.x, touchInput.y);
    }

    function startTouchInput(e: PointerEvent) {
      if (e.pointerType !== "touch" || touchInput.active) {
        return;
      }

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
      if (e.pointerId !== touchInput.pointerId) {
        return;
      }

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

    const pointer = {
      x: 0,
      y: 0,
    };

    let last = performance.now();
    let lastBroadcast = 0;
    const maxTouchDistance = 90;
    const touchDeadzone = 8;

    let attackTime = 0;
    let cooldown = 0;

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

    function gyroAndAccelHandler(dx: number, dy: number) {
      const currentOrientation = debugRef.current.orientation;
      const currentMotion = debugRef.current.motion;

      if (!currentOrientation || !currentMotion) return;

      const motionDeltaX = prevMotionX !== null ? currentMotion.x - prevMotionX : 0;
      const motionDeltaY = prevMotionY !== null ? currentMotion.y - prevMotionY : 0;
      const motionDeltaZ = prevMotionZ !== null ? currentMotion.z - prevMotionZ : 0;

      if (
        prevAlpha !== null &&
        prevBeta !== null &&
        prevGamma !== null &&
        prevMotionX !== null &&
        prevMotionY !== null &&
        prevMotionZ !== null
      ) {
        const alphaDelta = Math.abs(currentOrientation.alpha - prevAlpha);
        const betaDelta = Math.abs(currentOrientation.beta - prevBeta);
        const gammaDelta = Math.abs(currentOrientation.gamma - prevGamma);
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

        // shield detection
        if (betaDelta >= SHIELD_BETA_THRESHOLD && accelZDelta >= SHIELD_Y_THRESHOLD) {
          if (shieldTimer) {
            clearTimeout(shieldTimer);
          }

          // TODO: BACKEND - server.js only has a socket.on("input", ...) handler
          // right now. There's no "shield" event wired up server-side, so this
          // currently only updates local debug state and does nothing to the
          // actual game. Once the server adds a shield handler, this should be:
          //   socket.emit("shield", { active: true });
          debugStats.shieldActive = true;
          debugStats.lastTrigger = performance.now();

          shieldTimer = setTimeout(() => {
            // TODO: BACKEND - same as above, no server-side shield handler yet.
            //   socket.emit("shield", { active: false });
            shieldTimer = null;
            debugStats.shieldActive = false;
          }, SHIELD_DURATION);
        }

        // attack detection
        else {
          const attackMagnitude = Math.hypot(motionDeltaX, motionDeltaY, motionDeltaZ);
          debugStats.attackMagnitude = attackMagnitude;

          if (attackMagnitude >= ATTACK_ACCEL_THRESHOLD) {
            const alphaRadians = currentOrientation.alpha * (Math.PI / 180);
            const gyroX = Math.sin(currentOrientation.gamma * (Math.PI / 180));
            const gyroY = Math.sin(currentOrientation.beta * (Math.PI / 180));
            const attackVectorX = motionDeltaX + gyroX;
            const attackVectorY = motionDeltaY + gyroY;
            const attackDirection = normalizeRadians(
              Math.atan2(attackVectorY, attackVectorX) + alphaRadians
            );
            debugStats.attackDirection = attackDirection;
            debugStats.attackVectorX = attackVectorX;
            debugStats.attackVectorY = attackVectorY;
            debugStats.attackTriggered = true;

            // TODO: BACKEND - same story as shield above: server.js has no
            // "attack" event handler yet, so there's nowhere on the backend
            // for this to land. Once it exists, this should be:
            //   socket.emit("attack", {
            //     origin: { x: dx, y: dy },
            //     timestamp: Date.now(),
            //     direction: attackDirection,
            //   });

            return;
          }
        }
      }

      prevAlpha = currentOrientation.alpha;
      prevBeta = currentOrientation.beta;
      prevGamma = currentOrientation.gamma;
      prevMotionX = currentMotion.x;
      prevMotionY = currentMotion.y;
      prevMotionZ = currentMotion.z;
    }

    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

      if (dt > 0) {
        const instantFps = 1 / dt;
        debugStats.fps = debugStats.fps
          ? debugStats.fps * 0.9 + instantFps * 0.1
          : instantFps;
      }

      attackTime -= dt;
      cooldown -= dt;

      if (attackTime < 0) attackTime = 0;
      if (cooldown < 0) cooldown = 0;

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

      // Send our input to the server at a throttled rate (the server owns
      // position integration in its own tick loop, mirrors Controller.tsx).
      if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
        socket.emit("input", { dx, dy });
        lastBroadcast = now;
      }

      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#2f2f2f";
      ctx.lineWidth = 1;

      gyroAndAccelHandler(dx, dy);

      // playerShieldApplier(cameraX, cameraY);

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    // Periodically push a snapshot of the live sensor/game values into
    // React state so the debug overlay can render them without forcing
    // a re-render on every animation frame.
    const debugInterval = setInterval(() => {
      setDebugData({
        orientation: debugRef.current.orientation ?? null,
        motion: debugRef.current.motion ?? null,
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
        localPos: { x: localPlayer.x, y: localPlayer.y },
      });
    }, DEBUG_REFRESH_MS);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", startTouchInput);
      canvas.removeEventListener("pointermove", updateTouchInput);
      canvas.removeEventListener("pointerup", endTouchInput);
      canvas.removeEventListener("pointercancel", endTouchInput);
      if (shieldTimer) {
        clearTimeout(shieldTimer);
      }
      clearInterval(debugInterval);
      socket.disconnect();
    };
  }, []);

  return (
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

      {/* HUD: username + gold */}
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
        <div style={{ fontWeight: 600 }}>{playerName || "Player"}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#f6e05e",
            marginTop: 2,
          }}
        >
          <img
            src="/assets/ui/coin-removebg-preview.png"
            alt="Coin"
            width={16}
            height={16}
            style={{ display: "block" }}
          />
          <span>0</span>
        </div>
      </div>

      <img
        src="/assets/ui/instruction_box-removebg-preview.png"
        alt="Shield Instructions"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          width: 120,
          height: 120,
          objectFit: "cover",
          borderRadius: 8,
          border: "2px dashed rgba(255,255,255,0.3)",
          background: "rgba(255,255,255,0.05)",
          zIndex: 900,
        }}
      />
      <img
        src="/assets/ui/instruction_attack-removebg-preview.png"
        alt="Attack Instructinos"
        style={{
          position: "fixed",
          top: 144,
          right: 16,
          width: 120,
          height: 120,
          objectFit: "cover",
          borderRadius: 8,
          border: "2px dashed rgba(255,255,255,0.3)",
          background: "rgba(255,255,255,0.05)",
          zIndex: 900,
        }}
      />

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
          <div style={{ color: "#9ae6b4", marginBottom: 6, fontSize: 12 }}>
            SENSOR DEBUG
          </div>

          <div style={{ color: "#718096", marginTop: 6 }}>ORIENTATION</div>
          <div>alpha: {fmt(debugData.orientation?.alpha)}</div>
          <div>beta: {fmt(debugData.orientation?.beta)}</div>
          <div>gamma: {fmt(debugData.orientation?.gamma)}</div>

          <div style={{ color: "#718096", marginTop: 6 }}>ORIENTATION DELTA</div>
          <div>alphaDelta: {fmt(debugData.alphaDelta)}</div>
          <div>betaDelta: {fmt(debugData.betaDelta)}</div>
          <div>gammaDelta: {fmt(debugData.gammaDelta)}</div>

          <div style={{ color: "#718096", marginTop: 6 }}>MOTION (accel)</div>
          <div>x: {fmt(debugData.motion?.x)}</div>
          <div>y: {fmt(debugData.motion?.y)}</div>
          <div>z: {fmt(debugData.motion?.z)}</div>

          <div style={{ color: "#718096", marginTop: 6 }}>MOTION DELTA</div>
          <div>accelXDelta: {fmt(debugData.accelXDelta)}</div>
          <div>accelYDelta: {fmt(debugData.accelYDelta)}</div>
          <div>accelZDelta: {fmt(debugData.accelZDelta)}</div>

          <div style={{ color: "#718096", marginTop: 6 }}>ATTACK DETECTION</div>
          <div>magnitude: {fmt(debugData.attackMagnitude)}</div>
          <div>vectorX: {fmt(debugData.attackVectorX)}</div>
          <div>vectorY: {fmt(debugData.attackVectorY)}</div>
          <div>
            direction: {debugData.attackDirection === null ? "—" : `${fmt(debugData.attackDirection, 3)} rad`}
          </div>
          <div>
            fired: {debugData.attackTriggered ? "YES" : "no"}
          </div>

          <div style={{ color: "#718096", marginTop: 6 }}>SHIELD DETECTION</div>
          <div>
            betaDelta: {fmt(debugData.betaDelta)}{" "}
            <span style={{ color: debugData.betaDelta > SHIELD_BETA_THRESHOLD ? "#f6ad55" : "#4a5568" }}>
              (thr {SHIELD_BETA_THRESHOLD})
            </span>
          </div>
          <div>
            accelZDelta: {fmt(debugData.accelZDelta)}{" "}
            <span style={{ color: debugData.accelZDelta > SHIELD_Y_THRESHOLD ? "#f6ad55" : "#4a5568" }}>
              (thr {SHIELD_Y_THRESHOLD})
            </span>
          </div>
          <div>
            shield:{" "}
            <span style={{ color: debugData.shieldActive ? "#9ae6b4" : "#718096" }}>
              {debugData.shieldActive ? "ACTIVE" : "idle"}
            </span>
          </div>
          <div>
            last trigger:{" "}
            {debugData.lastTrigger
              ? `${fmt((performance.now() - debugData.lastTrigger) / 1000, 1)}s ago`
              : "—"}
          </div>

          <div style={{ color: "#718096", marginTop: 6 }}>GAME</div>
          <div>fps: {fmt(debugData.fps, 0)}</div>
          <div>uuid: {debugData.playerUuid ? `${debugData.playerUuid.slice(0, 8)}…` : "—"}</div>
        </div>
      )}
    </>
  );
}