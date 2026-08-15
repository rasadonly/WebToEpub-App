import { useState, useEffect, lazy, Suspense } from 'react';

const SupportedSites = lazy(() => import('@/components/SupportedSites'));
const AdminPanel = lazy(() => import('@/components/AdminPanel'));
const LibraryModal = lazy(() => import('@/components/LibraryModal'));
const EpubReaderModal = lazy(() => import('@/components/EpubReaderModal'));
const LiveReaderModal = lazy(() => import('@/components/LiveReaderModal'));
const ForumModal = lazy(() => import('@/components/ForumModal'));

export function GlobalModals() {
  const [supportedOpen, setSupportedOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [epubReaderOpen, setEpubReaderOpen] = useState(false);
  const [liveReaderOpen, setLiveReaderOpen] = useState(false);
  const [forumOpen, setForumOpen] = useState(false);
  const [liveReaderUrl, setLiveReaderUrl] = useState('');

  useEffect(() => {
    const handleOpenModal = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'supported-sites') setSupportedOpen(true);
      else if (detail === 'admin') setAdminOpen(true);
      else if (detail === 'library') setLibraryOpen(true);
      else if (detail === 'epub-reader') setEpubReaderOpen(true);
      else if (detail === 'forum') setForumOpen(true);
      else if (detail === 'live-reader') {
        setLiveReaderUrl('');
        setLiveReaderOpen(true);
      }
    };
    window.addEventListener('open-modal', handleOpenModal);
    return () => window.removeEventListener('open-modal', handleOpenModal);
  }, []);

  return (
    <Suspense fallback={null}>
      {supportedOpen && <SupportedSites open={supportedOpen} onOpenChange={setSupportedOpen} hideTrigger />}
      {adminOpen && <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} hideTrigger />}
      {libraryOpen && <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />}
      {epubReaderOpen && <EpubReaderModal open={epubReaderOpen} onClose={() => setEpubReaderOpen(false)} />}
      {liveReaderOpen && <LiveReaderModal open={liveReaderOpen} url={liveReaderUrl} onClose={() => setLiveReaderOpen(false)} />}
      {forumOpen && <ForumModal open={forumOpen} onClose={() => setForumOpen(false)} />}
    </Suspense>
  );
}
