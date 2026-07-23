import ConversionForm from '@/components/ConversionForm';
import ProgressLog from '@/components/ProgressLog';
import ChapterManager from '@/components/ChapterManager';
import { useEpubConverter } from '@/hooks/useEpubConverter';
import { Button } from '@/components/ui/button';
import { RefreshCw, Github, Heart } from 'lucide-react';

const Index = () => {
  const {
    progress,
    logs,
    chapterList,
    setChapterList,
    fetchChapters,
    generateFromChapters,
    resetConverter,
    isConverting,
    isGenerating
  } = useEpubConverter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-gradient-primary rounded-full shadow-glow">
            <span className="text-2xl">📚</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              Link to EPUB
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Transform web novels from popular sites into beautiful EPUB files.
              Supports Novelhall, Novelfull, NovelBin, FreeWebNovel, NovelFire, NovGo, NovelBuddy, NovelArrow, and WTR-LAB.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-6">
          <ConversionForm onSubmit={fetchChapters} isConverting={isConverting} />
          {chapterList && chapterList.length > 0 && (
            <ChapterManager
              chapters={chapterList}
              onChange={setChapterList}
              onGenerate={generateFromChapters}
              isGenerating={isGenerating}
            />
          )}
          <ProgressLog progress={progress} logs={logs} />
        </div>

        {/* Reset Button */}
        {(progress.status === 'complete' || progress.status === 'error') && (
          <div className="flex justify-center">
            <Button
              onClick={resetConverter}
              variant="outline"
              className="gap-2 transition-smooth hover:shadow-card"
            >
              <RefreshCw className="w-4 h-4" />
              Convert Another Novel
            </Button>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center space-y-4 pt-12 border-t border-border/50">
          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <a
              href="https://github.com/dteviot/WebToEpub"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-primary transition-smooth"
            >
              <Github className="w-4 h-4" />
              Inspired by WebToEpub
            </a>
            <span className="flex items-center gap-1">
              Made with <Heart className="w-4 h-4 text-red-500" /> for novel readers
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            <p>
              Supports Novelhall, Novelfull, NovelBin, FreeWebNovel, NovelFire,
              NovGo, NovelBuddy, NovelArrow, and WTR-LAB
            </p>
            <p className="mt-1">
              Your settings are automatically saved per domain for convenience
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Index;
