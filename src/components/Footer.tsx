import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="w-full border-t border-border/80 bg-card/40 mt-16 py-10">
      <div className="container mx-auto px-4 max-w-5xl text-center space-y-5">
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
          Works with <Link to="/sites" className="text-primary hover:underline font-semibold">380+ sites</Link> — Royal Road, NovelBin, Scribble Hub, WTR-LAB and more.
          Free online web novel conversion with zero account required.
        </p>
        <div className="flex flex-wrap justify-center gap-3 sm:gap-6 text-xs sm:text-sm text-muted-foreground font-medium">
          <Link to="/converter" className="hover:text-primary transition-colors font-semibold">Best EPUB converter for web novels</Link>
          <span className="text-border">·</span>
          <Link to="/web-to-epub" className="hover:text-primary transition-colors">Web to EPUB Tool</Link>
          <span className="text-border">·</span>
          <Link to="/alternatives" className="hover:text-primary transition-colors">WebToEpub Alternative</Link>
          <span className="text-border">·</span>
          <Link to="/sites" className="hover:text-primary transition-colors">Supported Sites</Link>
          <span className="text-border">·</span>
          <Link to="/guide" className="hover:text-primary transition-colors">How-to Guide</Link>
          <span className="text-border">·</span>
          <Link to="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
        </div>
        <div className="pt-2 text-xs text-muted-foreground/60">
          © {new Date().getFullYear()} LinkToEpub. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
