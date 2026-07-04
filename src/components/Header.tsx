import { Link, NavLink as RouterNavLink } from "react-router-dom";
import { CartDrawer } from "./CartDrawer";
import { Search, Menu, X, ShieldCheck } from "lucide-react";
import { useState } from "react";
import logoHorizontal from "@/assets/secretpdf-horizontal.png.asset.json";

const NAV = [
  { label: "Library", to: "/library" },
  { label: "Categories", to: "/categories" },
  { label: "Bundles", to: "/bundles" },
  { label: "About", to: "/about" },
  { label: "Downloads", to: "/download" },
];

export const Header = () => {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-md border-b border-border">
      {/* Announcement bar */}
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

      <div className="container flex items-center justify-between h-20 gap-4">
        <Link to="/" className="flex items-center group" aria-label="SecretPDF home">
          <img
            src={logoHorizontal.url}
            alt="SecretPDF"
            className="h-9 sm:h-10 w-auto transition-transform group-hover:scale-[1.02]"
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => (
            <RouterNavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-4 py-2 font-sans text-sm font-medium rounded-full transition-all ${
                  isActive
                    ? "bg-highlight text-primary"
                    : "text-foreground/70 hover:text-primary hover:bg-secondary"
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
            className="hidden sm:flex h-11 w-11 rounded-full border border-border bg-background hover:bg-secondary transition-colors items-center justify-center"
          >
            <Search className="h-4.5 w-4.5 text-foreground/70" strokeWidth={2} />
          </button>
          <CartDrawer />
          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className="md:hidden h-11 w-11 rounded-full border border-border bg-background flex items-center justify-center"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="container py-4 flex flex-col gap-1">
            {NAV.map((item) => (
              <RouterNavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `px-4 py-3 font-sans text-base rounded-lg ${
                    isActive ? "bg-highlight text-primary" : "text-foreground/80 hover:bg-secondary"
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
