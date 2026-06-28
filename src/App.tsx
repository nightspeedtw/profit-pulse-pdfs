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
import NotFound from "./pages/NotFound.tsx";
import AdminLogin from "./pages/admin/Login.tsx";
import AdminLayout from "./pages/admin/AdminLayout.tsx";
import Dashboard from "./pages/admin/Dashboard.tsx";
import SettingsPage from "./pages/admin/Settings.tsx";
import AdminCategories from "./pages/admin/Categories.tsx";
import Ideas from "./pages/admin/Ideas.tsx";
import Pipeline from "./pages/admin/Pipeline.tsx";
import EbookReview from "./pages/admin/EbookReview.tsx";
import EbookWriting from "./pages/admin/EbookWriting.tsx";
import EbookCover from "./pages/admin/EbookCover.tsx";
import EbookPDF from "./pages/admin/EbookPDF.tsx";
import Costs from "./pages/admin/Costs.tsx";
import Autopilot from "./pages/admin/Autopilot.tsx";

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
            <Route path="/bundles" element={<Bundles />} />
            <Route path="/about" element={<About />} />
          </Route>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="ideas" element={<Ideas />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="autopilot" element={<Autopilot />} />
            <Route path="ebook/:id" element={<EbookReview />} />
            <Route path="ebook/:id/writing" element={<EbookWriting />} />
            <Route path="ebook/:id/cover" element={<EbookCover />} />
            <Route path="ebook/:id/pdf" element={<EbookPDF />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="costs" element={<Costs />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
