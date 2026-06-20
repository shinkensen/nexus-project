"use client";

import { useEffect, useRef } from "react";
import { supabase } from "../backend/supabase";
import { setPosition, setShield } from "../backend/funcs";
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;

export const PLAYER_SIZE = 100;
export const PLAYER_SPEED = 1000; 

const ATTACK_COOLDOWN_TIME = 4; 
const SHIELD_COOLDOWN_TIME = 3;

const GAMMA_THRESHOLD = 5;
const Y_THRESHOLD = 6;
const SHIELD_DURATION = 3000;
const BURN_DURATION = 1000;

const BROADCAST_INTERVAL_MS = 100;

type Orientation = { alpha: number; beta: number; gamma: number };
type Motion = { x: number; y: number; z: number };

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

  const debugRef = useRef({ orientation, motion });
  useEffect(() => {
    debugRef.current = { orientation, motion };
  }, [orientation, motion]);

  let health = 100;
  let shark = true;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    let width = window.innerWidth;
    let height = window.innerHeight;

    let clientShield = false;

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

    let prevGamma: number | null = null;
    let prevMotionX: number | null = null;
    let prevMotionY: number | null = null;
    let prevMotionZ: number | null = null;
    let shieldTimer: ReturnType<typeof setTimeout> | null = null;

    function gyroAndAccelHandler() {
      const currentOrientation = debugRef.current.orientation;
      const currentMotion = debugRef.current.motion;

      if (!currentOrientation || !currentMotion) return;


      if (prevGamma !== null && prevMotionY !== null) {
        const gammaDelta = Math.abs(currentOrientation.gamma - prevGamma);
        const accelYDelta = Math.abs(currentMotion.y - prevMotionY);
        
        // box detection
        if (gammaDelta > GAMMA_THRESHOLD && accelYDelta > Y_THRESHOLD) {
          const playerUuid = localStorage.getItem("player_uuid");
          if (playerUuid) {
            clientShield = true;

            if (shieldTimer) {
              clearTimeout(shieldTimer);
            }

            void setShield(playerUuid, true);

            shieldTimer = setTimeout(() => {
              void setShield(playerUuid, false);
              shieldTimer = null;
            }, SHIELD_DURATION);
          }

        }
      }

      prevGamma = currentOrientation.gamma;
      prevMotionX = currentMotion.x;
      prevMotionY = currentMotion.y;
      prevMotionZ = currentMotion.z;
    }


    function loop(now: number) {
      const dt = (now - last) / 1000;
      last = now;

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


      gyroAndAccelHandler();

      // playerShieldApplier(cameraX, cameraY);


      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

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
      supabase.removeChannel(channel);
    };
  }, []);

  return (
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
  );
}