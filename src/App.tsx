import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-load secondary pages so homepage bundle stays small
const SitesPage = lazy(() => import("./pages/SitesPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));


const queryClient = new QueryClient();

function NavBar() {
  const loc = useLocation();
  const linkClass = (path: string) =>
    `text-sm transition-colors hover:text-primary ${loc.pathname === path ? 'text-primary font-medium' : 'text-muted-foreground'}`;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 flex items-center justify-between h-12 max-w-5xl">
        <Link to="/" className="font-bold text-base tracking-tight hover:text-primary transition-colors">
          LinkToEpub
        </Link>
        <nav className="flex items-center gap-5">
          <Link to="/sites" className={linkClass('/sites')}>Sites</Link>
          <Link to="/guide" className={linkClass('/guide')}>Guide</Link>
          <Link to="/privacy" className={linkClass('/privacy')}>Privacy</Link>
        </nav>
      </div>
    </header>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <NavBar />
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        }>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
