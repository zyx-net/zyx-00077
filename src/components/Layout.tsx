import { ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  AlertTriangle,
  Settings,
  FileBarChart,
  Database,
  Menu,
  X,
  Clock,
} from 'lucide-react';
import { useAppStore } from '@/store';

interface LayoutProps {
  children: ReactNode;
}

interface MenuItem {
  path: string;
  label: string;
  icon: ReactNode;
}

const menuItems: MenuItem[] = [
  { path: '/', label: '仪表盘', icon: <LayoutDashboard size={20} /> },
  { path: '/import', label: '数据导入', icon: <Upload size={20} /> },
  { path: '/anomalies', label: '异常分析', icon: <AlertTriangle size={20} /> },
  { path: '/rules', label: '规则配置', icon: <Settings size={20} /> },
  { path: '/reports', label: '统计报告', icon: <FileBarChart size={20} /> },
  { path: '/batches', label: '批次管理', icon: <Database size={20} /> },
];

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const { currentBatchId, batches } = useAppStore();
  
  const currentBatch = batches.find(b => b.id === currentBatchId);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-[#1e3a5f] text-white transition-all duration-300 flex flex-col fixed h-full z-20`}
      >
        <div className="p-4 border-b border-[#2a4a73] flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Clock className="text-[#f97316]" size={24} />
              <h1 className="font-bold text-lg">考勤对账</h1>
            </div>
          )}
          {!sidebarOpen && <Clock className="text-[#f97316] mx-auto" size={24} />}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-[#2a4a73] rounded transition-colors"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={`sidebar-link ${
                location.pathname === item.path ? 'active' : ''
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              {item.icon}
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {sidebarOpen && currentBatch && (
          <div className="p-4 border-t border-[#2a4a73]">
            <div className="text-xs text-slate-400 mb-1">当前批次</div>
            <div className="text-sm font-medium truncate">{currentBatch.name}</div>
            <div className="text-xs text-slate-400 mt-1">
              {new Date(currentBatch.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        )}
      </aside>

      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarOpen ? 'ml-64' : 'ml-20'
        }`}
      >
        <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">
                {menuItems.find((m) => m.path === location.pathname)?.label ||
                  '仪表盘'}
              </h2>
              {currentBatch && location.pathname !== '/batches' && (
                <p className="text-sm text-slate-500 mt-0.5">
                  批次: {currentBatch.name}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {currentBatch && (
                <span className={`badge ${
                  currentBatch.status === 'completed' ? 'bg-green-100 text-green-600' :
                  currentBatch.status === 'importing' || currentBatch.status === 'analyzing' ? 'bg-blue-100 text-blue-600' :
                  currentBatch.status === 'archived' ? 'bg-gray-100 text-gray-600' :
                  'bg-orange-100 text-orange-600'
                }`}>
                  {currentBatch.status === 'completed' ? '已完成' :
                   currentBatch.status === 'importing' ? '导入中' :
                   currentBatch.status === 'analyzing' ? '分析中' :
                   currentBatch.status === 'archived' ? '已归档' : '草稿'}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
