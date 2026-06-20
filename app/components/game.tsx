"use client";

import { useState, useEffect } from "react";

interface Player {
  username: string;
  x: number;
  y: number;
}

export default function Game() {
  const [username, setUsername] = useState("");
  const [player, setPlayer] = useState<Player>({
    username: "",
    x: 50,
    y: 50
  });
  const [keys, setKeys] = useState<{ [key: string]: boolean }>({});

  // Save username to localStorage
  useEffect(() => {
    const savedUsername = localStorage.getItem("username");
    if (savedUsername) {
      setUsername(savedUsername);
      setPlayer(prev => ({ ...prev, username: savedUsername }));
    }
  }, []);

  // Update username
  const handleUsername = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUsername = e.target.value;
    setUsername(newUsername);
    setPlayer(prev => ({ ...prev, username: newUsername }));
    localStorage.setItem("username", newUsername);
  };

  // Handle key presses
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setKeys(prev => ({ ...prev, [e.key.toLowerCase()]: true }));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setKeys(prev => ({ ...prev, [e.key.toLowerCase()]: false }));
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Update player position
  useEffect(() => {
    const moveSpeed = 5;
    const boundaries = {
      left: 20,
      right: 80,
      top: 20,
      bottom: 80
    };

    if (keys.w) player.y = Math.max(boundaries.top, player.y - moveSpeed);
    if (keys.s) player.y = Math.min(100 - boundaries.bottom, player.y + moveSpeed);
    if (keys.a) player.x = Math.max(boundaries.left, player.x - moveSpeed);
    if (keys.d) player.x = Math.min(100 - boundaries.right, player.x + moveSpeed);

    setPlayer(prev => ({
      ...prev,
      x: player.x,
      y: player.y
    }));
  }, [keys]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="mb-8">
        <input
          type="text"
          value={username}
          onChange={handleUsername}
          placeholder="Enter your username"
          className="p-2 text-black rounded bg-gray-200"
        />
      </div>

      <div className="relative w-[90vh] h-[90vh] bg-gray-800 rounded-lg border-2 border-gray-700">
        <div
          className="absolute w-8 h-8 bg-blue-500 rounded-full"
          style={{
            left: `${player.x}%`,
            top: `${player.y}%`
          }}
        >
          <span className="text-white text-xs font-bold">
            {player.username || "Player"}
          </span>
        </div>
        <div className="absolute bottom-4 left-4 text-gray-300 text-sm">
          Use WASD to move
        </div>
      </div>
    </div>
  );
}