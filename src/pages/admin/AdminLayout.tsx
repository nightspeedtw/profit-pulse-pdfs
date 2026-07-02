import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { fetchAdminData } from "@/lib/adminData";
import { Button } from "@/components/ui/button";
import { Gauge, Factory, Package, Settings as SettingsIcon, LogOut, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

const PASSCODE_KEY = "admin_passcode_ok";

const nav = [
  { to: "/admin", label: "Command Center", icon: Gauge, end: true },
  { to: "/admin/production", label: "Production", icon: Factory },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [costToday, setCostToday] = useState<number>(0);
  const authed = typeof window !== "undefined" && localStorage.getItem(PASSCODE_KEY) === "1";

  useEffect(() => {
    if (!authed) return;
    fetchAdminData<{ cost_today: number }>("production")
      .then((d) => setCostToday(Number(d?.cost_today ?? 0)))
      .catch((err) => console.error("[AdminLayout] cost load failed", err));
  }, [authed]);

  if (!authed) return <Navigate to="/admin/login" replace />;

  const signOut = () => {
    localStorage.removeItem(PASSCODE_KEY);
    navigate("/admin/login");
  };


  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-56 border-r-2 border-foreground bg-card flex flex-col">
        <div className="p-5 border-b-2 border-foreground">
          <p className="font-mono uppercase tracking-widest text-xs">[ Admin ]</p>
          <h2 className="font-display text-xl uppercase leading-tight mt-1 flex items-center gap-2">
            <Sparkles className="size-5" /> Ebook Factory
          </h2>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-sm font-medium border-2 ${
                  isActive ? "border-foreground bg-highlight" : "border-transparent hover:border-foreground/30"
                }`
              }
            >
              <n.icon className="size-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t-2 border-foreground space-y-2">
          <p className="text-xs text-muted-foreground truncate">Passcode session</p>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b-2 border-foreground bg-card flex items-center justify-between px-6">
          <div className="font-mono uppercase tracking-widest text-xs">Premium ebook pipeline</div>
          <div className="text-sm">
            <span className="text-muted-foreground">Today's AI cost:</span>{" "}
            <span className="font-bold">${costToday.toFixed(4)}</span>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
