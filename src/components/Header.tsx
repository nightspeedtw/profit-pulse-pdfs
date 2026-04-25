import { Link, NavLink as RouterNavLink } from "react-router-dom";
import { CartDrawer } from "./CartDrawer";
import { Search, Menu, X } from "lucide-react";
import { useState } from "react";

const NAV = [
  { label: "Library", to: "/library" },
  { label: "Categories", to: "/categories" },
  { label: "Bundles", to: "/bundles" },
  { label: "About", to: "/about" },
];

export const Header = () => {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-background border-b-2 border-foreground">
      {/* Announcement bar */}
      <div className="bg-foreground text-background overflow-hidden">
        <div className="marquee py-2 text-xs font-mono uppercase tracking-widest">
          {[0, 1].map((i) => (
            <div key={i} className="marquee-content">
              {Array.from({ length: 8 }).map((_, j) => (
                <span key={j} className="flex items-center gap-3 whitespace-nowrap">
                  <span className="text-highlight">★</span>
                  Instant PDF Delivery
                  <span className="text-highlight">★</span>
                  Print Unlimited Copies
                  <span className="text-highlight">★</span>
                  30-Day Money Back
                  <span className="text-highlight">★</span>
                  Trusted by 50K+ Creators
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="container flex items-center justify-between h-20 gap-4">
        <Link to="/" className="flex items-center gap-2 group" aria-label="Printly home">
          <div className="h-10 w-10 bg-accent border-2 border-foreground flex items-center justify-center font-display text-accent-foreground text-xl group-hover:rotate-3 transition-transform">
            P
          </div>
          <span className="font-display text-2xl uppercase tracking-tight hidden sm:inline">
            Printly
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => (
            <RouterNavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-4 py-2 font-display text-sm uppercase tracking-wide border-2 transition-all ${
                  isActive
                    ? "border-foreground bg-highlight"
                    : "border-transparent hover:border-foreground hover:bg-secondary"
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
            className="hidden sm:flex h-12 w-12 border-2 border-foreground bg-background hover:bg-highlight transition-colors items-center justify-center"
          >
            <Search className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <CartDrawer />
          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className="md:hidden h-12 w-12 border-2 border-foreground bg-background flex items-center justify-center"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {open && (
        <div className="md:hidden border-t-2 border-foreground bg-background">
          <nav className="container py-4 flex flex-col gap-1">
            {NAV.map((item) => (
              <RouterNavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `px-4 py-3 font-display text-base uppercase border-2 ${
                    isActive ? "border-foreground bg-highlight" : "border-transparent hover:border-foreground"
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
