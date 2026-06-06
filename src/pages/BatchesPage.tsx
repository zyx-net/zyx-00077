import { useState, useMemo } from 'react';
import {
  Database,
  Plus,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  Filter,
  ChevronDown,
  Calendar,
  Users,
  AlertTriangle,
  FileText,
  X,
} from 'lucide-react';
import Layout from '@/components/Layout';
import StatCard from '@/components/StatCard';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import type { Batch } from '@/types';

const statusConfig: Record<Batch['status'], { label: string; color: string; bgColor: string }> = {
  draft: { label: '草稿', color: 'text-slate-600', bgColor: 'bg-slate-100' },
  importing: { label: '导入中', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  analyzing: { label: '分析中', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  completed: { label: '已完成', color: 'text-green-600', bgColor: 'bg-green-100' },
  archived: { label: '已归档', color: 'text-gray-600', bgColor: 'bg-gray-100' },
};

export default function BatchesPage() {
  const {
    batches,
    currentBatchId,
    loading,
    createBatch,
    selectBatch,
    deleteBatch,
    setLoading,
  } = useAppStore();
  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Batch['status'] | 'all'>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchTimezone, setNewBatchTimezone] = useState('Asia/Shanghai');

  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      const matchSearch = batch.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' || batch.status === statusFilter;
      const matchDateStart = !dateRange.start || new Date(batch.createdAt) >= new Date(dateRange.start);
      const matchDateEnd = !dateRange.end || new Date(batch.createdAt) <= new Date(dateRange.end + 'T23:59:59');
      return matchSearch && matchStatus && matchDateStart && matchDateEnd;
    });
  }, [batches, searchTerm, statusFilter, dateRange]);

  const stats = useMemo(() => {
    const totalBatches = batches.length;
    const completedBatches = batches.filter(b => b.status === 'completed').length;
    const totalRecords = batches.reduce((sum, b) => sum + b.stats.totalSchedules + b.stats.totalPunches + b.stats.totalLeaves, 0);
    const totalAnomalies = batches.reduce((sum, b) => sum + b.stats.totalAnomalies, 0);
    return { totalBatches, completedBatches, totalRecords, totalAnomalies };
  }, [batches]);

  const handleCreateBatch = async () => {
    if (!newBatchName.trim()) {
      showToast('error', '请输入批次名称');
      return;
    }
    try {
      setLoading(true);
      const batch = await createBatch(newBatchName.trim(), newBatchTimezone);
      showToast('success', `批次 "${batch.name}" 创建成功`);
      setShowCreateModal(false);
      setNewBatchName('');
      setNewBatchTimezone('Asia/Shanghai');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '创建批次失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBatch = async (batch: Batch) => {
    try {
      setLoading(true);
      await selectBatch(batch.id);
      showToast('success', `已切换到批次 "${batch.name}"`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '选择批次失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBatch = async () => {
    if (!selectedBatch) return;
    try {
      setLoading(true);
      await deleteBatch(selectedBatch.id);
      showToast('success', `批次 "${selectedBatch.name}" 已删除`);
      setShowDeleteModal(false);
      setSelectedBatch(null);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除批次失败');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = (batch: Batch) => {
    setSelectedBatch(batch);
    setShowDetailModal(true);
  };

  const openDeleteConfirm = (batch: Batch) => {
    setSelectedBatch(batch);
    setShowDeleteModal(true);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && batches.length === 0) {
    return <Loading fullScreen text="加载批次数据中..." />;
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">批次管理</h1>
            <p className="text-slate-500 mt-1">管理所有数据批次，创建、选择和删除批次</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            创建新批次
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="总批次"
            value={stats.totalBatches}
            icon={<Database size={24} />}
            color="blue"
          />
          <StatCard
            title="已完成"
            value={stats.completedBatches}
            icon={<CheckCircle size={24} />}
            color="green"
          />
          <StatCard
            title="总记录数"
            value={stats.totalRecords.toLocaleString()}
            icon={<FileText size={24} />}
            color="purple"
          />
          <StatCard
            title="总异常数"
            value={stats.totalAnomalies.toLocaleString()}
            icon={<AlertTriangle size={24} />}
            color="orange"
          />
        </div>

        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="搜索批次名称..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-slate-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as Batch['status'] | 'all')}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              >
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="importing">导入中</option>
                <option value="analyzing">分析中</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-slate-400" />
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              />
              <span className="text-slate-400">至</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              />
            </div>
            {(searchTerm || statusFilter !== 'all' || dateRange.start || dateRange.end) && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setDateRange({ start: '', end: '' });
                }}
                className="text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                <X size={16} />
                清除筛选
              </button>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">批次名称</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">状态</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">创建时间</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-slate-600">排班数据</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-slate-600">打卡数据</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-slate-600">异常数</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-slate-600">当前批次</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                      <Database size={48} className="mx-auto mb-4 text-slate-300" />
                      <p>暂无批次数据</p>
                      <p className="text-sm mt-1">点击"创建新批次"开始</p>
                    </td>
                  </tr>
                ) : (
                  filteredBatches.map(batch => {
                    const status = statusConfig[batch.status];
                    const isCurrent = currentBatchId === batch.id;
                    return (
                      <tr
                        key={batch.id}
                        className={`hover:bg-slate-50 transition-colors ${isCurrent ? 'bg-[#1e3a5f]/5' : ''}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isCurrent ? 'bg-[#1e3a5f]' : 'bg-slate-100'}`}>
                              <Database size={20} className={isCurrent ? 'text-white' : 'text-slate-600'} />
                            </div>
                            <div>
                              <div className="font-medium text-slate-800">{batch.name}</div>
                              <div className="text-xs text-slate-500">时区: {batch.timezone}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`badge ${status.bgColor} ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">
                          {formatDate(batch.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Users size={14} className="text-slate-400" />
                            <span className="text-slate-700">{batch.stats.totalSchedules}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Clock size={14} className="text-slate-400" />
                            <span className="text-slate-700">{batch.stats.totalPunches}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <AlertCircle size={14} className="text-[#f97316]" />
                            <span className="text-[#f97316] font-medium">{batch.stats.totalAnomalies}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isCurrent ? (
                            <span className="badge bg-[#1e3a5f]/10 text-[#1e3a5f]">
                              <CheckCircle size={12} className="mr-1" />
                              当前批次
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSelectBatch(batch)}
                              className="text-sm text-[#1e3a5f] hover:text-[#2a4a73] font-medium"
                            >
                              设为当前
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openDetail(batch)}
                              className="p-2 text-slate-500 hover:text-[#1e3a5f] hover:bg-[#1e3a5f]/10 rounded-lg transition-colors"
                              title="查看详情"
                            >
                              <ChevronDown size={18} />
                            </button>
                            <button
                              onClick={() => openDeleteConfirm(batch)}
                              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除批次"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredBatches.length > 0 && (
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 text-sm text-slate-500">
              共 {filteredBatches.length} 个批次
            </div>
          )}
        </div>

        <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="创建新批次"
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                批次名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newBatchName}
                onChange={e => setNewBatchName(e.target.value)}
                placeholder="请输入批次名称，如：2024年1月考勤数据"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                时区
              </label>
              <select
                value={newBatchTimezone}
                onChange={e => setNewBatchTimezone(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (香港时间)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (东京时间)</option>
                <option value="America/New_York">America/New_York (纽约时间)</option>
                <option value="Europe/London">Europe/London (伦敦时间)</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateBatch}
                disabled={!newBatchName.trim()}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                创建批次
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={showDetailModal && selectedBatch !== null}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedBatch(null);
          }}
          title={`批次详情 - ${selectedBatch?.name}`}
          size="lg"
        >
          {selectedBatch && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-sm text-slate-500">排班记录</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">
                    {selectedBatch.stats.totalSchedules}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-sm text-slate-500">打卡记录</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">
                    {selectedBatch.stats.totalPunches}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-sm text-slate-500">调休记录</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">
                    {selectedBatch.stats.totalLeaves}
                  </div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-sm text-orange-600">异常总数</div>
                  <div className="text-2xl font-bold text-[#f97316] mt-1">
                    {selectedBatch.stats.totalAnomalies}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-blue-600">待处理异常</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {selectedBatch.stats.pendingAnomalies}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-green-600">已修正异常</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {selectedBatch.stats.correctedAnomalies}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-sm text-slate-600">处理进度</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">
                    {selectedBatch.stats.totalAnomalies > 0
                      ? ((selectedBatch.stats.correctedAnomalies / selectedBatch.stats.totalAnomalies) * 100).toFixed(1)
                      : 0}%
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-slate-700">基本信息</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">批次ID：</span>
                    <span className="text-slate-700 font-mono">{selectedBatch.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">状态：</span>
                    <span className={`badge ${statusConfig[selectedBatch.status].bgColor} ${statusConfig[selectedBatch.status].color}`}>
                      {statusConfig[selectedBatch.status].label}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">创建时间：</span>
                    <span className="text-slate-700">{formatDate(selectedBatch.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">更新时间：</span>
                    <span className="text-slate-700">{formatDate(selectedBatch.updatedAt)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">时区：</span>
                    <span className="text-slate-700">{selectedBatch.timezone}</span>
                  </div>
                </div>
              </div>

              {selectedBatch.stats.totalAnomalies > 0 && (
                <div>
                  <h4 className="font-semibold text-slate-700 mb-3">处理进度</h4>
                  <div className="w-full bg-slate-200 rounded-full h-3">
                    <div
                      className="bg-[#1e3a5f] h-3 rounded-full transition-all duration-500"
                      style={{
                        width: `${(selectedBatch.stats.correctedAnomalies / selectedBatch.stats.totalAnomalies) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-sm text-slate-500">
                    <span>待处理: {selectedBatch.stats.pendingAnomalies}</span>
                    <span>已处理: {selectedBatch.stats.correctedAnomalies}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedBatch(null);
                  }}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  关闭
                </button>
                {currentBatchId !== selectedBatch.id && (
                  <button
                    onClick={() => {
                      handleSelectBatch(selectedBatch);
                      setShowDetailModal(false);
                      setSelectedBatch(null);
                    }}
                    className="btn-primary"
                  >
                    设为当前批次
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>

        <Modal
          isOpen={showDeleteModal && selectedBatch !== null}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedBatch(null);
          }}
          title="确认删除"
          size="sm"
        >
          {selectedBatch && (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={24} className="text-red-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">确定要删除此批次吗？</h4>
                  <p className="text-sm text-slate-500 mt-2">
                    批次名称：<span className="font-medium text-slate-700">{selectedBatch.name}</span>
                  </p>
                  <p className="text-sm text-red-600 mt-2">
                    此操作将永久删除该批次及其所有关联数据，包括排班记录、打卡记录、异常数据等。此操作不可撤销。
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedBatch(null);
                  }}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteBatch}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
