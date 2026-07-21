import { Link, useLocation, useNavigate } from "react-router-dom";
import { User as UserIcon, LogOut, LayoutDashboard, Library, ShoppingBag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import { supabase } from "@/integrations/supabase/client";

export function AccountMenu({ variant = "light" }: { variant?: "light" | "dark" }) {
  const { user, loading } = useAccountAuth();
  const location = useLocation();
  const nav = useNavigate();

  const btnClass =
    variant === "dark"
      ? "h-11 px-4 rounded-full border border-white/15 bg-white/10 text-[#F1EDFF] hover:bg-white/20 text-sm font-medium transition-colors"
      : "h-11 px-4 rounded-full border border-border bg-background hover:bg-secondary text-sm font-medium transition-colors";

  const iconBtn =
    variant === "dark"
      ? "h-11 w-11 rounded-full border border-white/15 bg-white/10 hover:bg-white/20 flex items-center justify-center"
      : "h-11 w-11 rounded-full border border-border bg-background hover:bg-secondary flex items-center justify-center";

  if (loading) {
    return <div className={iconBtn} aria-hidden />;
  }

  if (!user) {
    const rememberNext = () => {
      const p = location.pathname + location.search;
      if (p.startsWith("/") && !p.startsWith("/account/sign-in")) {
        sessionStorage.setItem("auth:next", p);
      }
    };
    return (
      <Link
        to="/account/sign-in"
        onClick={rememberNext}
        className={btnClass}
        aria-label="Sign in"
      >
        Sign in
      </Link>
    );
  }

  const initial = (user.email?.[0] ?? "U").toUpperCase();
  const displayName =
    (user.user_metadata as { full_name?: string; name?: string })?.full_name ||
    (user.user_metadata as { name?: string })?.name ||
    user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={iconBtn} aria-label="Account menu">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account"><LayoutDashboard className="h-4 w-4 mr-2" />Overview</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/library"><Library className="h-4 w-4 mr-2" />My Library</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/orders"><ShoppingBag className="h-4 w-4 mr-2" />Orders</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/profile"><UserIcon className="h-4 w-4 mr-2" />Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async (e) => {
            e.preventDefault();
            await supabase.auth.signOut();
            nav("/", { replace: true });
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
