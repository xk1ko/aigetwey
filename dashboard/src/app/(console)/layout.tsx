import { Rail } from "@/components/Rail";
import { TopBar } from "@/components/TopBar";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="console-grid">
      <aside className="console-rail">
        <Rail />
      </aside>

      <div className="console-col">
        <TopBar />
        <main className="console-main">{children}</main>
      </div>
    </div>
  );
}
