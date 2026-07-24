import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ConversionProgress } from '@/types';
import { CheckCircle, AlertCircle, Loader2, Download, Square } from 'lucide-react';

interface ProgressLogProps {
  progress: ConversionProgress;
  logs: string[];
  onStop?: () => void;
}

export default function ProgressLog({ progress, logs }: ProgressLogProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getStatusIcon = () => {
    switch (progress.status) {
      case 'complete':
        return <CheckCircle className="w-5 h-5 text-success" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      case 'idle':
        return null;
      default:
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
    }
  };

  const getStatusColor = () => {
    switch (progress.status) {
      case 'complete':
        return 'text-success';
      case 'error':
        return 'text-destructive';
      case 'idle':
        return 'text-muted-foreground';
      default:
        return 'text-primary';
    }
  };

  const progressPercentage = progress.totalChapters > 0 
    ? Math.round((progress.currentChapter / progress.totalChapters) * 100)
    : 0;

  if (progress.status === 'idle' && logs.length === 0) {
    return null;
  }

  return (
    <Card className="w-full max-w-2xl mx-auto p-6 bg-gradient-card shadow-card border-0 animate-slide-up">
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div className="flex-1">
            <h3 className={`font-semibold ${getStatusColor()}`}>
              {progress.message || 'Ready to convert'}
            </h3>
            {progress.totalChapters > 0 && (
              <p className="text-sm text-muted-foreground">
                Chapter {progress.currentChapter} of {progress.totalChapters}
              </p>
            )}
          </div>
          {progress.status === 'complete' && (
            <Download className="w-5 h-5 text-success animate-pulse-glow" />
          )}
        </div>

        {/* Progress Bar */}
        {progress.status !== 'idle' && progress.status !== 'error' && progress.totalChapters > 0 && (
          <div className="space-y-2">
            <Progress 
              value={progressPercentage} 
              className="h-2 bg-muted"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progressPercentage}% complete</span>
              <span>{progress.currentChapter}/{progress.totalChapters} chapters</span>
            </div>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Conversion Log
            </h4>
            <div className="bg-muted/30 rounded-lg p-4 max-h-64 overflow-y-auto">
              <div className="space-y-1 font-mono text-sm">
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className="text-muted-foreground animate-slide-up"
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <span className="text-primary">•</span> {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}