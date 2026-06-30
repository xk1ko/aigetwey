import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <TopBar />
      <main className="app-content">{children}</main>
    </div>
  );
}
