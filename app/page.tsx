"use client";

import { useState } from "react";
import Game from "./components/game";

export default function HomePage() {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

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
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) setSubmitted(true);
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

  return <Game playerName={name} />;
}