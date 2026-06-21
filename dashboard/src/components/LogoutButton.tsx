"use client";

import { useRouter } from "next/navigation";
import { Button } from "./Button";
import { Icon } from "./Icon";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" onClick={logout} className="w-full">
      <Icon name="logout" size={17} />
      Disconnect
    </Button>
  );
}
