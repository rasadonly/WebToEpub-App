import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Globe, BookOpenCheck, Settings, Library as LibraryIcon, BookMarked, MessagesSquare, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveStats } from "@/components/LiveStats";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-load secondary pages so homepage bundle stays small
// Lazy-load secondary pages so homepage bundle stays small
const SitesPage = lazy(() => import("./pages/SitesPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const ConverterPage = lazy(() => import("./pages/ConverterPage"));
const WebToEpubPage = lazy(() => import("./pages/WebToEpubPage"));
const AlternativesPage = lazy(() => import("./pages/AlternativesPage"));

const queryClient = new QueryClient();

/** Dispatch a custom event that ConversionForm listens for */
const openModal = (name: string) =>
  window.dispatchEvent(new CustomEvent("open-modal", { detail: name }));

function NavBar() {
  const loc = useLocation();
  const linkClass = (path: string) =>
    `text-sm transition-colors hover:text-primary ${loc.pathname === path ? "text-primary font-medium" : "text-muted-foreground"}`;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 flex items-center justify-between h-12 max-w-5xl gap-3">
        {/* Brand */}
        <Link to="/" className="font-bold text-base tracking-tight hover:text-primary transition-colors shrink-0">
          LinkToEpub
        </Link>

        {/* Page nav */}
        <nav className="hidden md:flex items-center gap-4">
          <Link to="/converter" className={linkClass("/converter")}>EPUB Converter</Link>
          <Link to="/web-to-epub" className={linkClass("/web-to-epub")}>Web to EPUB</Link>
          <Link to="/alternatives" className={linkClass("/alternatives")}>WebToEpub Alt</Link>
          <Link to="/sites" className={linkClass("/sites")}>Sites</Link>
          <Link to="/guide" className={linkClass("/guide")}>Guide</Link>
        </nav>

        {/* Right side: live stats + action menu */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="hidden md:block">
            <LiveStats />
          </div>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More options"
                className="h-8 w-8 rounded-full border border-border bg-card/70 hover:bg-card transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-52">
              <DropdownMenuItem onSelect={() => openModal("supported-sites")}>
                <Globe className="w-4 h-4 mr-2" /> Supported Sites
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openModal("live-reader")}>
                <BookOpenCheck className="w-4 h-4 mr-2" /> Live Reader
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openModal("library")}>
                <LibraryIcon className="w-4 h-4 mr-2" /> Library
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openModal("epub-reader")}>
                <BookMarked className="w-4 h-4 mr-2" /> EPUB Reader
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openModal("forum")}>
                <MessagesSquare className="w-4 h-4 mr-2" /> Community Forum
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openModal("admin")}>
                <Settings className="w-4 h-4 mr-2" /> Admin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
            <Route path="/converter" element={<ConverterPage />} />
            <Route path="/web-to-epub" element={<WebToEpubPage />} />
            <Route path="/alternatives" element={<AlternativesPage />} />
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
