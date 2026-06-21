"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const uuid = localStorage.getItem("player_uuid");

  router.push('/controller')
  }, [router]);

  return null;
}
