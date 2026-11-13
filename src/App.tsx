import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import Index from "./pages/Index.tsx";
const Library = lazy(() => import("./pages/Library.tsx"));
const Categories = lazy(() => import("./pages/Categories.tsx"));
const Category = lazy(() => import("./pages/Category.tsx"));
const Product = lazy(() => import("./pages/Product.tsx"));
const Bundles = lazy(() => import("./pages/Bundles.tsx"));
const About = lazy(() => import("./pages/About.tsx"));
const Download = lazy(() => import("./pages/Download.tsx"));
const Kids = lazy(() => import("./pages/Kids.tsx"));
const KidsCategory = lazy(() => import("./pages/KidsCategory.tsx"));

const MarketingAutopilot = lazy(() => import("./pages/admin/MarketingAutopilot.tsx"));
import { Navigate } from "react-router-dom";
const KidsCheckout = lazy(() => import("./pages/KidsCheckout.tsx"));
const Create = lazy(() => import("./pages/Create.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const ColoringProduct = lazy(() => import("./pages/ColoringProduct.tsx"));
const AdminLogin = lazy(() => import("./pages/admin/Login.tsx"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.tsx"));
const CommandCenter = lazy(() => import("./pages/admin/Dashboard.tsx"));
const Production = lazy(() => import("./pages/admin/Production.tsx"));
const Products = lazy(() => import("./pages/admin/Products.tsx"));
const SettingsPage = lazy(() => import("./pages/admin/Settings.tsx"));
const EbookReview = lazy(() => import("./pages/admin/EbookReview.tsx"));
const EbookWriting = lazy(() => import("./pages/admin/EbookWriting.tsx"));
const EbookCover = lazy(() => import("./pages/admin/EbookCover.tsx"));
const EbookPDF = lazy(() => import("./pages/admin/EbookPDF.tsx"));
const AutopilotRun = lazy(() => import("./pages/admin/AutopilotRun.tsx"));
const ProductionCommandCenter = lazy(() => import("./pages/admin/ProductionCommandCenter.tsx"));
const InternalStore = lazy(() => import("./pages/admin/InternalStore.tsx"));
const SmokeTestStatus = lazy(() => import("./pages/admin/SmokeTestStatus.tsx"));
const AutopilotControl = lazy(() => import("./pages/admin/AutopilotControl.tsx"));
const KidsAutopilot = lazy(() => import("./pages/admin/KidsAutopilot.tsx"));
const KidsQcReport = lazy(() => import("./pages/admin/KidsQcReport.tsx"));
const KidsLibrary = lazy(() => import("./pages/admin/KidsLibrary.tsx"));
const Blog = lazy(() => import("./pages/Blog.tsx"));
const BlogPost = lazy(() => import("./pages/BlogPost.tsx"));
import { FEATURES } from "@/config/features.ts";
const ColoringLabV2 = lazy(() => import("./pages/admin/ColoringLabV2.tsx"));
const ColoringPreviewV2 = lazy(() => import("./pages/ColoringPreviewV2.tsx"));
const DriveShop = lazy(() => import("./pages/DriveShop.tsx"));
const DriveImporter = lazy(() => import("./pages/admin/DriveImporter.tsx"));
const StoryBatchV2 = lazy(() => import("./pages/admin/StoryBatchV2.tsx"));
const AccountLayout = lazy(() => import("./pages/account/AccountLayout.tsx"));
const AccountOverview = lazy(() => import("./pages/account/Overview.tsx"));
const AccountSignIn = lazy(() => import("./pages/account/SignIn.tsx"));
const AccountForgotPassword = lazy(() => import("./pages/account/ForgotPassword.tsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.tsx"));
const AccountResetPassword = lazy(() => import("./pages/account/ResetPassword.tsx"));
const AccountMyLibrary = lazy(() => import("./pages/account/MyLibrary.tsx"));
const AccountOrders = lazy(() => import("./pages/account/Orders.tsx"));
const AccountOrderDetail = lazy(() => import("./pages/account/OrderDetail.tsx"));
const AccountDownloads = lazy(() => import("./pages/account/Downloads.tsx"));
const AccountInvoices = lazy(() => import("./pages/account/Invoices.tsx"));
const AccountNotifications = lazy(() => import("./pages/account/Notifications.tsx"));
const AccountSupport = lazy(() => import("./pages/account/Support.tsx"));
const AccountProfile = lazy(() => import("./pages/account/Profile.tsx"));
const AccountSecurity = lazy(() => import("./pages/account/Security.tsx"));
const AccountPrivacy = lazy(() => import("./pages/account/Privacy.tsx"));
const Pricing = lazy(() => import("./pages/Pricing.tsx"));
const PrivacyPolicy = lazy(() => import("./pages/legal/Privacy.tsx"));
const Terms = lazy(() => import("./pages/legal/Terms.tsx"));
const RefundPolicy = lazy(() => import("./pages/legal/Refund.tsx"));
const LicenseTerms = lazy(() => import("./pages/LicenseTerms.tsx"));
const CommercialLibrary = lazy(() => import("./pages/CommercialLibrary.tsx"));
const AdminCommercial = lazy(() => import("./pages/AdminCommercial.tsx"));



const SeoAutopilot = lazy(() => import("./pages/admin/SeoAutopilot.tsx"));


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        {/* Every page except the home page is its own chunk (the single 1.4 MB bundle held the
            whole admin and checkout). Home stays in the entry so its first paint needs no extra request. */}
        <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Index />} />
            <Route path="/library" element={<Library />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/category/:slug" element={<Category />} />
            <Route path="/product/:handle" element={<Product />} />
            <Route path="/kids" element={<Kids />} />
            <Route path="/kids/coloring/:id" element={<ColoringProduct />} />
            <Route path="/kids/:categorySlug" element={<KidsCategory />} />
            <Route path="/royalty" element={<Navigate to="/" replace />} />
            <Route path="/royalty/book/:bookId" element={<Navigate to="/" replace />} />
            <Route path="/my-royalties" element={<Navigate to="/" replace />} />
            <Route path="/exchange" element={<Navigate to="/" replace />} />
            <Route path="/exchange/book/:bookId" element={<Navigate to="/" replace />} />
            <Route path="/exchange/portfolio" element={<Navigate to="/" replace />} />
            <Route path="/exchange/wallet" element={<Navigate to="/" replace />} />
            <Route path="/kids/checkout/:id" element={<KidsCheckout />} />
            <Route path="/create" element={<Create />} />
            <Route path="/bundles" element={<Bundles />} />
            <Route path="/about" element={<About />} />
            <Route path="/download" element={<Download />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/refund-policy" element={<RefundPolicy />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/return" element={<CheckoutReturn />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/shop" element={<DriveShop />} />
            <Route path="/shop/:slug" element={<DriveShop />} />
            {FEATURES.ENABLE_COLORING_LANE_V2 && (
              <Route path="/coloring-preview-v2/:bookId" element={<ColoringPreviewV2 />} />
            )}

            <Route path="/account/sign-in" element={<AccountSignIn />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/account/forgot-password" element={<AccountForgotPassword />} />
            <Route path="/account/reset-password" element={<AccountResetPassword />} />
            <Route path="/account" element={<AccountLayout />}>
              <Route index element={<AccountOverview />} />
              <Route path="library" element={<AccountMyLibrary />} />
              <Route path="orders" element={<AccountOrders />} />
              <Route path="orders/:id" element={<AccountOrderDetail />} />
              <Route path="downloads" element={<AccountDownloads />} />
              <Route path="invoices" element={<AccountInvoices />} />
              <Route path="notifications" element={<AccountNotifications />} />
              <Route path="support" element={<AccountSupport />} />
              <Route path="profile" element={<AccountProfile />} />
              <Route path="security" element={<AccountSecurity />} />
              <Route path="privacy" element={<AccountPrivacy />} />
              <Route path="commercial-library" element={<CommercialLibrary />} />
              <Route path="royalties" element={<Navigate to="/account" replace />} />
            </Route>
            <Route path="/legal/license" element={<LicenseTerms />} />

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
            <Route path="marketing-autopilot" element={<MarketingAutopilot />} />
            <Route path="seo-autopilot" element={<SeoAutopilot />} />
            <Route path="drive-importer" element={<DriveImporter />} />
            {FEATURES.ENABLE_STORY_BATCH_50_V2 && (
              <Route path="story-batch-v2" element={<StoryBatchV2 />} />
            )}
            <Route path="ebook/:id" element={<EbookReview />} />
            <Route path="ebook/:id/writing" element={<EbookWriting />} />
            <Route path="ebook/:id/cover" element={<EbookCover />} />
            <Route path="ebook/:id/pdf" element={<EbookPDF />} />
            <Route path="autopilot/run/:runId" element={<AutopilotRun />} />
            {FEATURES.ENABLE_COLORING_LANE_V2 && (
              <Route path="coloring-lab-v2" element={<ColoringLabV2 />} />
            )}
            <Route path="commercial" element={<AdminCommercial />} />
          </Route>


          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
