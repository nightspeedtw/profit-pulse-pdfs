import { Link } from "react-router-dom";
import { Instagram, Twitter, Youtube, ShieldCheck } from "lucide-react";
import logoIcon from "@/assets/secretpdf-icon.png";

export const Footer = () => (
  <footer className="bg-primary text-primary-foreground mt-24">
    <div className="container py-16">
      <div className="grid md:grid-cols-4 gap-10">
        <div className="md:col-span-2">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-11 w-11 rounded-xl bg-background/10 backdrop-blur flex items-center justify-center overflow-hidden">
              <img src={logoIcon} alt="" className="h-9 w-9 object-contain" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display text-2xl tracking-tight">
                Secret<span className="text-accent">PDF</span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.28em] text-primary-foreground/60">
                Private · Secure · Trusted
              </span>
            </div>
          </div>
          <p className="font-sans text-primary-foreground/70 max-w-md leading-relaxed">
            A private library of expert-authored PDFs. Encrypted delivery, lifetime access, and
            a 30-day money-back guarantee. Built for readers who value clarity and confidentiality.
          </p>
          <div className="flex items-center gap-3 mt-6">
            {[Instagram, Twitter, Youtube].map((Icon, i) => (
              <a
                key={i}
                href="#"
                aria-label="Social"
                className="h-10 w-10 rounded-full border border-primary-foreground/20 hover:bg-accent hover:border-accent transition-colors flex items-center justify-center"
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
              </a>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-sans uppercase text-[11px] font-semibold tracking-[0.2em] mb-4 text-accent">
            Shop
          </h3>
          <ul className="space-y-2.5 font-sans text-sm text-primary-foreground/80">
            <li><Link to="/library" className="hover:text-accent transition-colors">Full Library</Link></li>
            <li><Link to="/categories" className="hover:text-accent transition-colors">Categories</Link></li>
            <li><Link to="/bundles" className="hover:text-accent transition-colors">Bundles</Link></li>
            <li><Link to="/library?sort=new" className="hover:text-accent transition-colors">New Releases</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="font-sans uppercase text-[11px] font-semibold tracking-[0.2em] mb-4 text-accent">
            Company
          </h3>
          <ul className="space-y-2.5 font-sans text-sm text-primary-foreground/80">
            <li><Link to="/about" className="hover:text-accent transition-colors">About</Link></li>
            <li><a href="#" className="hover:text-accent transition-colors">FAQ</a></li>
            <li><a href="#" className="hover:text-accent transition-colors">Refund Policy</a></li>
            <li><a href="#" className="hover:text-accent transition-colors">Contact</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-primary-foreground/10 mt-12 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono tracking-wider text-primary-foreground/50">
        <p>© {new Date().getFullYear()} SecretPDF. All rights reserved.</p>
        <p className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
          Encrypted delivery · Secure checkout
        </p>
      </div>
    </div>
  </footer>
);
