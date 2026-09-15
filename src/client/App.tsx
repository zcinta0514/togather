import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CreatePage from './pages/CreatePage';
import FillPage from './pages/FillPage';
import ResultsPage from './pages/ResultsPage';
import FinalPage from './pages/FinalPage';
import MyEventsPage from './pages/MyEventsPage';

export default function App() {
  return (
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
  );
}
