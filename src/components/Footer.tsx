import { Link } from "react-router-dom";
import { Instagram, Twitter, Youtube } from "lucide-react";

export const Footer = () => (
  <footer className="bg-foreground text-background border-t-2 border-foreground mt-24">
    <div className="container py-16">
      <div className="grid md:grid-cols-4 gap-8">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 bg-accent border-2 border-background flex items-center justify-center font-display text-accent-foreground text-xl">
              P
            </div>
            <span className="font-display text-2xl uppercase">Printly</span>
          </div>
          <p className="font-sans text-background/70 max-w-md leading-relaxed">
            The premium library of printable knowledge. Instant downloads. Unlimited prints.
            Crafted for creators, learners, and doers worldwide.
          </p>
          <div className="flex gap-3 mt-6">
            {[Instagram, Twitter, Youtube].map((Icon, i) => (
              <a
                key={i}
                href="#"
                aria-label="Social"
                className="h-10 w-10 border-2 border-background hover:bg-accent transition-colors flex items-center justify-center"
              >
                <Icon className="h-4 w-4" strokeWidth={2.5} />
              </a>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-display uppercase text-sm tracking-wider mb-4 text-highlight">Shop</h3>
          <ul className="space-y-2 font-sans text-background/80">
            <li><Link to="/library" className="hover:text-highlight">Full Library</Link></li>
            <li><Link to="/categories" className="hover:text-highlight">Categories</Link></li>
            <li><Link to="/bundles" className="hover:text-highlight">Bundles</Link></li>
            <li><Link to="/library?sort=new" className="hover:text-highlight">New Releases</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="font-display uppercase text-sm tracking-wider mb-4 text-highlight">Help</h3>
          <ul className="space-y-2 font-sans text-background/80">
            <li><Link to="/about" className="hover:text-highlight">About</Link></li>
            <li><a href="#" className="hover:text-highlight">FAQ</a></li>
            <li><a href="#" className="hover:text-highlight">Refund Policy</a></li>
            <li><a href="#" className="hover:text-highlight">Contact</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t-2 border-background/20 mt-12 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono uppercase tracking-wider text-background/60">
        <p>© {new Date().getFullYear()} Printly Inc. All rights reserved.</p>
        <p>Made with ink &amp; pixels.</p>
      </div>
    </div>
  </footer>
);
