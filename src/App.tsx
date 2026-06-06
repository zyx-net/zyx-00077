import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '@/contexts/ToastContext';
import { useAppStore } from '@/store';
import Loading from '@/components/Loading';
import Dashboard from '@/pages/Dashboard';
import ImportPage from '@/pages/ImportPage';
import AnomalyPage from '@/pages/AnomalyPage';
import RulesPage from '@/pages/RulesPage';
import ReportsPage from '@/pages/ReportsPage';
import BatchesPage from '@/pages/BatchesPage';

function AppContent() {
  const { initApp, loading, error, initialized, setError } = useAppStore();

  useEffect(() => {
    if (!initialized) {
      initApp();
    }
  }, [initialized, initApp]);

  if (!initialized && loading) {
    return <Loading fullScreen text="应用初始化中..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">应用初始化失败</h2>
          <p className="text-slate-500 mb-4">{error}</p>
          <button
            onClick={() => {
              setError(null);
              initApp();
            }}
            className="btn-primary"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/anomalies" element={<AnomalyPage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/batches" element={<BatchesPage />} />
      <Route path="*" element={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-6xl font-bold text-[#1e3a5f] mb-4">404</h1>
            <p className="text-slate-500 mb-6">页面未找到</p>
            <a href="/" className="btn-primary">返回首页</a>
          </div>
        </div>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Router>
        <AppContent />
      </Router>
    </ToastProvider>
  );
}
