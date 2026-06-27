import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Settings, FolderOpen, Lightbulb, Kanban, DollarSign, LogOut, Sparkles, Plane } from "lucide-react";
import { useEffect, useState } from "react";

const nav = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/autopilot", label: "Autopilot", icon: Plane },
  { to: "/admin/ideas", label: "Ideas", icon: Lightbulb },
  { to: "/admin/pipeline", label: "Pipeline", icon: Kanban },
  { to: "/admin/categories", label: "Categories", icon: FolderOpen },
  { to: "/admin/costs", label: "Costs", icon: DollarSign },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminLayout() {
  const { session, isAdmin, loading, user } = useAuth();
  const navigate = useNavigate();
  const [costToday, setCostToday] = useState<number>(0);

  useEffect(() => {
    if (!isAdmin) return;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    supabase
      .from("cost_log")
      .select("cost_usd")
      .gte("created_at", since.toISOString())
      .then(({ data }) => {
        const total = (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
        setCostToday(total);
      });
  }, [isAdmin]);

  if (loading) return <div className="min-h-screen grid place-items-center">Loading…</div>;
  if (!session) return <Navigate to="/admin/login" replace />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="font-display text-3xl uppercase">Not authorized</h1>
          <p className="text-muted-foreground">Your account is signed in but does not have admin access.</p>
          <Button onClick={async () => { await supabase.auth.signOut(); navigate("/admin/login"); }}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 border-r-2 border-foreground bg-card flex flex-col">
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
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={async () => { await supabase.auth.signOut(); navigate("/admin/login"); }}
          >
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
