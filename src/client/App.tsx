import { Routes, Route, Navigate } from 'react-router-dom';
import CreatePage from './pages/CreatePage';
import FillPage from './pages/FillPage';
import ResultsPage from './pages/ResultsPage';
import FinalPage from './pages/FinalPage';
import MyEventsPage from './pages/MyEventsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/new" replace />} />
      <Route path="/new" element={<CreatePage />} />
      <Route path="/my" element={<MyEventsPage />} />
      <Route path="/e/:id" element={<ResultsPage />} />
      <Route path="/e/:id/fill" element={<FillPage />} />
      <Route path="/e/:id/final" element={<FinalPage />} />
      <Route path="*" element={<Navigate to="/new" replace />} />
    </Routes>
  );
}
