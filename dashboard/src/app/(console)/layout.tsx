import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { NavigationProgress } from "@/components/NavigationProgress";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <NavigationProgress />
      <Sidebar />
      <TopBar />
      <main className="app-content">{children}</main>
    </div>
  );
}
