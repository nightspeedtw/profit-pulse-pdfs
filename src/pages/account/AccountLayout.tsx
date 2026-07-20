import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import {
  LayoutDashboard, Library, ShoppingBag, Download, FileText,
  Bell, LifeBuoy, User as UserIcon, Shield, Lock, Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { Skeleton } from "@/components/ui/skeleton";

const NAV = [
  { to: "/account", end: true, icon: LayoutDashboard, label: "Overview" },
  { to: "/account/library", icon: Library, label: "My Library" },
  { to: "/account/orders", icon: ShoppingBag, label: "Orders" },
  { to: "/account/downloads", icon: Download, label: "Downloads" },
  { to: "/account/invoices", icon: FileText, label: "Invoices" },
  { to: "/account/notifications", icon: Bell, label: "Notifications" },
  { to: "/account/support", icon: LifeBuoy, label: "Support" },
  { to: "/account/profile", icon: UserIcon, label: "Profile" },
  { to: "/account/security", icon: Shield, label: "Security" },
  { to: "/account/privacy", icon: Lock, label: "Privacy" },
];

function NavItems({ onClick }: { onClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 text-sm">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onClick}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AccountLayout() {
  const { user, loading } = useAccountAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/account/sign-in", { replace: true });
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="container mx-auto py-6 md:py-10 px-4">
      <div className="flex items-center justify-between mb-6 md:hidden">
        <div>
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="text-sm font-medium truncate max-w-[220px]">{user.email}</p>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon"><Menu className="h-4 w-4" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <div className="mt-6"><NavItems /></div>
            <SignOutButton />
          </SheetContent>
        </Sheet>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 md:gap-10">
        <aside className="hidden md:block">
          <div className="sticky top-24 space-y-6">
            <div>
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="text-sm font-medium truncate">{user.email}</p>
            </div>
            <NavItems />
            <SignOutButton />
          </div>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start mt-4 text-muted-foreground"
      onClick={async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      }}
    >
      Sign out
    </Button>
  );
}
