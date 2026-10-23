import { Component, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunkReload';

interface ChunkBoundaryProps {
  children: ReactNode;
}

interface ChunkBoundaryState {
  error: Error | null;
}

/**
 * Catches errors from lazily-loaded chunks (Forum, Library, pages) so a
 * failed chunk never white-screens the whole app. Chunk-load failures
 * trigger a one-time automatic reload onto the fresh build; anything else
 * shows a small reload prompt instead of a blank page.
 */
export class ChunkBoundary extends Component<ChunkBoundaryProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChunkBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (isChunkLoadError(error)) {
      return (
        <div className="flex items-center justify-center min-h-[40vh] p-6">
          <p className="text-sm text-muted-foreground">Loading the latest version…</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[40vh] p-6 text-center">
        <p className="text-sm font-semibold text-foreground">Something failed to load.</p>
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
          A part of the app could not be loaded. Reloading the page usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
        >
          Reload page
        </button>
      </div>
    );
  }
}
