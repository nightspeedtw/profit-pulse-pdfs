import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { KidsFooter } from "./kids/KidsFooter";
import { PaymentTestModeBanner } from "./PaymentTestModeBanner";
import { useCartSync } from "@/hooks/useCartSync";

export const Layout = () => {
  useCartSync();
  const location = useLocation();
  const isKidsRoute = location.pathname.startsWith("/kids");

  useEffect(() => {
    document.body.classList.toggle("kids-theme", isKidsRoute);
    return () => { document.body.classList.remove("kids-theme"); };
  }, [isKidsRoute]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      {isKidsRoute ? <KidsFooter /> : <Footer />}
    </div>
  );
};
