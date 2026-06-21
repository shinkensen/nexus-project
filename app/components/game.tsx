"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../backend/supabase";
import { addAttack, setPosition, setShield } from "../backend/funcs";
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

type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

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

    const selfId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    const players: Record<string, { x: number, y: number, dx: number, dy: number, lastUpdate: number }> = {};

    const channel = supabase.channel('game_room')
      .on(
        'broadcast',
        { event: 'joystick' },
        (payload) => {
          const { uuid, dx, dy } = payload.payload;
          if (uuid === selfId) return;

          if (!players[uuid]) {
            players[uuid] = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, dx: 0, dy: 0, lastUpdate: performance.now() };
          }
          players[uuid].dx = dx;
          players[uuid].dy = dy;
          players[uuid].lastUpdate = performance.now();
        }
      )
      .subscribe();

    function keyDown(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = true;
    }

    function keyUp(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = false;
    }

    function updateTouchInput(e: PointerEvent) {
      if (!touchInput.active || e.pointerId !== touchInput.pointerId) {
        return;
      }

      touchInput.x = e.clientX;
      touchInput.y = e.clientY;
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
    }

    function endTouchInput(e: PointerEvent) {
      if (e.pointerId !== touchInput.pointerId) {
        return;
      }

      canvas.releasePointerCapture(e.pointerId);
      touchInput.active = false;
      touchInput.pointerId = -1;
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
          const playerUuid = localStorage.getItem("player_uuid");
          if (playerUuid) {

            if (shieldTimer) {
              clearTimeout(shieldTimer);
            }

            void setShield(playerUuid, true);
            debugStats.shieldActive = true;
            debugStats.lastTrigger = performance.now();

            shieldTimer = setTimeout(() => {
              void setShield(playerUuid, false);
              shieldTimer = null;
              debugStats.shieldActive = false;
            }, SHIELD_DURATION);
          }

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

            const playerUuid = localStorage.getItem("player_uuid");
            if (playerUuid) {
              addAttack(playerUuid, { x: dx, y: dy }, Date.now(), attackDirection);
            }

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
      
      // normalized mpovement
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
      }

      // supabase update position of the player
      const playerUuid = localStorage.getItem("player_uuid");
      if (playerUuid) {
        setPosition(playerUuid, { x: dx, y: dy });
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
        playerUuid: localStorage.getItem("player_uuid"),
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
      supabase.removeChannel(channel);
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