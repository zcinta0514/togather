import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const CreatePage = lazy(() => import('./pages/CreatePage'));
const FillPage = lazy(() => import('./pages/FillPage'));
const ResultsPage = lazy(() => import('./pages/ResultsPage'));
const FinalPage = lazy(() => import('./pages/FinalPage'));
const MyEventsPage = lazy(() => import('./pages/MyEventsPage'));

export default function App() {
  return (
    <Suspense fallback={<main className="p-6 text-ink-400">加载中…</main>}>
      <Routes>
        {/* 首页不再是创建表单 —— 第一次来的人得先看懂这是什么 */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/new" element={<CreatePage />} />
        <Route path="/my" element={<MyEventsPage />} />
        <Route path="/e/:id" element={<ResultsPage />} />
        <Route path="/e/:id/fill" element={<FillPage />} />
        <Route path="/e/:id/final" element={<FinalPage />} />
        {/* 认不出的地址回首页，不回创建页：首页有「粘贴链接」入口，
            链接打错的人在那里还有救；丢进表单页他就彻底卡住了。 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
