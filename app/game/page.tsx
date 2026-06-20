"use client";

import { useEffect, useState } from "react";
import Game from "../components/game";
import { useRouter } from "next/navigation";

export default function GamePage() {
  const [playerName, setPlayerName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const uuid = localStorage.getItem("player_uuid");
    const name = localStorage.getItem("player_name");

    if (!uuid || !name) {
      router.replace("/join");
      return;
    }

    setPlayerName(name);
    setLoaded(true);
  }, [router]);

  if (!loaded) return null;

  return <Game playerName={playerName} />;
}