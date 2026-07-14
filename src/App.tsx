import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import Index from "./pages/Index.tsx";
import Library from "./pages/Library.tsx";
import Categories from "./pages/Categories.tsx";
import Category from "./pages/Category.tsx";
import Product from "./pages/Product.tsx";
import Bundles from "./pages/Bundles.tsx";
import About from "./pages/About.tsx";
import Download from "./pages/Download.tsx";
import Kids from "./pages/Kids.tsx";
import KidsCheckout from "./pages/KidsCheckout.tsx";
import Checkout from "./pages/Checkout.tsx";
import CheckoutReturn from "./pages/CheckoutReturn.tsx";
import NotFound from "./pages/NotFound.tsx";
import AdminLogin from "./pages/admin/Login.tsx";
import AdminLayout from "./pages/admin/AdminLayout.tsx";
import CommandCenter from "./pages/admin/Dashboard.tsx";
import Production from "./pages/admin/Production.tsx";
import Products from "./pages/admin/Products.tsx";
import SettingsPage from "./pages/admin/Settings.tsx";
import EbookReview from "./pages/admin/EbookReview.tsx";
import EbookWriting from "./pages/admin/EbookWriting.tsx";
import EbookCover from "./pages/admin/EbookCover.tsx";
import EbookPDF from "./pages/admin/EbookPDF.tsx";
import AutopilotRun from "./pages/admin/AutopilotRun.tsx";
import ProductionCommandCenter from "./pages/admin/ProductionCommandCenter.tsx";
import InternalStore from "./pages/admin/InternalStore.tsx";
import SmokeTestStatus from "./pages/admin/SmokeTestStatus.tsx";
import AutopilotControl from "./pages/admin/AutopilotControl.tsx";
import KidsAutopilot from "./pages/admin/KidsAutopilot.tsx";
import KidsQcReport from "./pages/admin/KidsQcReport.tsx";
import KidsLibrary from "./pages/admin/KidsLibrary.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Index />} />
            <Route path="/library" element={<Library />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/category/:slug" element={<Category />} />
            <Route path="/product/:handle" element={<Product />} />
            <Route path="/kids" element={<Kids />} />
            <Route path="/bundles" element={<Bundles />} />
            <Route path="/about" element={<About />} />
            <Route path="/download" element={<Download />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/return" element={<CheckoutReturn />} />
          </Route>

          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<CommandCenter />} />
            <Route path="production" element={<Production />} />
            <Route path="production-command-center" element={<ProductionCommandCenter />} />
            <Route path="store" element={<InternalStore />} />
            <Route path="smoke-test" element={<SmokeTestStatus />} />
            <Route path="autopilot" element={<AutopilotControl />} />
            <Route path="kids" element={<KidsLibrary />} />
            <Route path="kids/autopilot" element={<KidsAutopilot />} />
            <Route path="kids/:id/qc" element={<KidsQcReport />} />
            <Route path="store/:id" element={<EbookReview />} />
            <Route path="products" element={<Products />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ebook/:id" element={<EbookReview />} />
            <Route path="ebook/:id/writing" element={<EbookWriting />} />
            <Route path="ebook/:id/cover" element={<EbookCover />} />
            <Route path="ebook/:id/pdf" element={<EbookPDF />} />
            <Route path="autopilot/run/:runId" element={<AutopilotRun />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
