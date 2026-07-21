import { Link, NavLink as RouterNavLink, useLocation } from "react-router-dom";
import { CartDrawer } from "./CartDrawer";
import { AccountMenu } from "./AccountMenu";
import { Search, Menu, X, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import logoHorizontal from "@/assets/secretpdf-horizontal.png";
import { KIDS_BRAND_URLS } from "./kids/KidsBrand";

const NAV = [
  { label: "Library", to: "/library" },
  { label: "Kids", to: "/kids" },
  { label: "Blog", to: "/blog" },
  
  { label: "Create & Earn", to: "/create" },
  { label: "Categories", to: "/categories" },
  { label: "Bundles", to: "/bundles" },
  { label: "About", to: "/about" },
  { label: "Pricing", to: "/pricing" },
  { label: "Downloads", to: "/download" },
];

export const Header = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isKidsRoute = location.pathname.startsWith("/kids");

  // Kids-themed color classes
  const headerBg = isKidsRoute
    ? "bg-[#070B2D]/85 backdrop-blur-md border-b border-[#FFC44D]/25"
    : "bg-background/90 backdrop-blur-md border-b border-border";

  const linkBase = isKidsRoute
    ? "text-[#F1EDFF]/85 hover:text-[#FFFDF8] hover:bg-white/10"
    : "text-foreground/70 hover:text-primary hover:bg-secondary";
  const linkActive = isKidsRoute
    ? "bg-[#F1EDFF]/15 text-[#FFE19A]"
    : "bg-highlight text-primary";

  const iconBtn = isKidsRoute
    ? "border-white/15 bg-white/10 text-[#F1EDFF] hover:bg-white/20"
    : "border-border bg-background hover:bg-secondary";

  return (
    <header className={`sticky top-0 z-40 ${headerBg}`}>
      {/* Announcement bar */}
      {isKidsRoute ? (
        <div className="bg-[#171052] text-[#FFE19A]">
          <div className="container flex items-center justify-center gap-2 py-2 text-[11px] uppercase tracking-[0.18em]">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="text-center text-[#F1EDFF]/90 normal-case tracking-normal text-xs">
              Instant PDF Download · Print at Home · Stories, Coloring, Activities &amp; Learning
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-primary text-primary-foreground overflow-hidden">
          <div className="marquee py-2 text-[11px] font-mono uppercase tracking-[0.2em]">
            {[0, 1].map((i) => (
              <div key={i} className="marquee-content">
                {Array.from({ length: 8 }).map((_, j) => (
                  <span key={j} className="flex items-center gap-3 whitespace-nowrap">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />
                    Private &amp; Encrypted Delivery
                    <span className="text-accent">•</span>
                    Instant PDF Download
                    <span className="text-accent">•</span>
                    30-Day Money Back
                    <span className="text-accent">•</span>
                    Trusted by 50K+ Readers
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="container flex items-center justify-between h-20 gap-4">
        <Link to={isKidsRoute ? "/kids" : "/"} className="flex items-center group" aria-label={isKidsRoute ? "SecretPDF Kids home" : "SecretPDF home"}>
          <img
            src={isKidsRoute ? KIDS_BRAND_URLS.full : logoHorizontal}
            alt={isKidsRoute ? "SecretPDF Kids" : "SecretPDF"}
            className={
              isKidsRoute
                ? "h-8 sm:h-9 w-auto transition-transform group-hover:scale-[1.02] drop-shadow-[0_2px_10px_rgba(255,196,77,0.3)]"
                : "h-9 sm:h-10 w-auto transition-transform group-hover:scale-[1.02]"
            }
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => (
            <RouterNavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-4 py-2 font-sans text-sm font-medium rounded-full transition-all ${
                  isActive ? linkActive : linkBase
                }`
              }
            >
              {item.label}
            </RouterNavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            aria-label="Search"
            className={`hidden sm:flex h-11 w-11 rounded-full border transition-colors items-center justify-center ${iconBtn}`}
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </button>
          <CartDrawer />
          <AccountMenu variant={isKidsRoute ? "dark" : "light"} />
          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className={`md:hidden h-11 w-11 rounded-full border flex items-center justify-center ${iconBtn}`}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {open && (
        <div className={`md:hidden border-t ${isKidsRoute ? "border-white/10 bg-[#070B2D]" : "border-border bg-background"}`}>
          <nav className="container py-4 flex flex-col gap-1">
            {NAV.map((item) => (
              <RouterNavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `px-4 py-3 font-sans text-base rounded-lg ${
                    isActive ? linkActive : linkBase
                  }`
                }
              >
                {item.label}
              </RouterNavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
};
