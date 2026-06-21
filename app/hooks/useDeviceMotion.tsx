// app/hooks/useDeviceMotion.ts
"use client";
import { useEffect, useRef, useState } from "react";

export function useDeviceMotion() {
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [motion, setMotion] = useState({ x: 0, y: 0, z: 0 });
  const [permissionNeeded, setPermissionNeeded] = useState(false);

  const handleOrientationRef = useRef((e: DeviceOrientationEvent) => {
    setOrientation({ alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 });

    // alpha = z
    // beta = x
    // gamma = y
  });
  const handleMotionRef = useRef((e: DeviceMotionEvent) => {
    const acc = e.accelerationIncludingGravity;
    setMotion({ x: acc?.x ?? 0, y: acc?.y ?? 0, z: acc?.z ?? 0 });
  });

  useEffect(() => {
    const needsPermission =
      typeof (DeviceMotionEvent as any)?.requestPermission === "function";
    setPermissionNeeded(needsPermission);

    if (!needsPermission) {
      window.addEventListener("deviceorientation", handleOrientationRef.current);
      window.addEventListener("devicemotion", handleMotionRef.current);
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientationRef.current);
      window.removeEventListener("devicemotion", handleMotionRef.current);
    };
  }, []);

  async function requestPermission() {
    try {
      const motionPerm = await (DeviceMotionEvent as any).requestPermission();
      const orientPerm = await (DeviceOrientationEvent as any).requestPermission();
      if (motionPerm === "granted" && orientPerm === "granted") {
        window.addEventListener("deviceorientation", handleOrientationRef.current);
        window.addEventListener("devicemotion", handleMotionRef.current);
        setPermissionNeeded(false);
      } else {
        console.warn("Motion/orientation permission denied", { motionPerm, orientPerm });
      }
    } catch (err) {
      console.error("Permission request failed", err);
    }
  }

  return { orientation, motion, permissionNeeded, requestPermission };
}