"use client";

import { useEffect, useState } from "react";
import { addPlayer } from "../backend/funcs";
import { useRouter } from "next/navigation";
import { useDeviceMotion } from "../hooks/useDeviceMotion";

export const MobileConnect = () => {
  const [name, setName] = useState("");
  const [submit, setSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const { orientation, motion, permissionNeeded, requestPermission } = useDeviceMotion();
  const router = useRouter();

  useEffect(() => {
    if (!submit) return;

    const join = async () => {
      setLoading(true);

      const result = await addPlayer(name);

      if (result.uuid) {
        localStorage.setItem("player_uuid", result.uuid);
        localStorage.setItem("player_name", name);
        router.push("/game");
      } else {
        console.error(result.error);
        alert(result.error ?? "Failed to join game");
      }

      setLoading(false);
      setSubmit(false);
    };

    join();
  }, [submit, name, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-3xl font-bold mb-8 text-blue-400">Join Game</h1>

      <div className="w-full max-w-sm space-y-4">
        <input
          className="w-full px-4 py-3 rounded bg-gray-800 border border-gray-700 focus:outline-none focus:border-blue-500 transition-colors text-white"
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter Your Name"
          value={name}
        />

        <button
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded transition-colors disabled:opacity-50"
          onClick={(e) => {
            if (permissionNeeded) {
              requestPermission();
            }
            setSubmit(true);
          }}
          disabled={!name || loading}
        >
          {loading ? "Joining..." : "Join"}
        </button>
      </div>
    </div>
  );
};