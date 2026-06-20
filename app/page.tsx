"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useDeviceMotion } from "./hooks/useDeviceMotion";

const Game = dynamic(() => import("./components/game"), { ssr: false });

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { orientation, motion, permissionNeeded, requestPermission } = useDeviceMotion();

  if (!submitted) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (permissionNeeded) {
              await requestPermission();
            }
            setSubmitted(true);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
          />
          <button type="submit">Play</button>
        </form>
      </div>
    );
  }
  const router = useRouter();
  
  useEffect(() => {
    const uuid = localStorage.getItem("player_uuid");

    if (!uuid) {
      router.replace("/join");
    } else {
      router.replace("/game");
    }
  }, [router]);
  
  return <Game playerName={name} orientation={orientation} motion={motion} />;
}