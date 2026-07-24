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
    stopConversion,
    isConverting,
    isGenerating
  } = useEpubConverter();

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 space-y-8">

        {/* Header intentionally minimal — form provides the hero */}


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
          <ProgressLog progress={progress} logs={logs} onStop={stopConversion} />
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

      </div>
    </div>
  );
};

export default Index;
