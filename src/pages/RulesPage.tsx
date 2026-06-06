import { useState, useMemo } from 'react';
import {
  Settings,
  ToggleLeft,
  ToggleRight,
  Edit3,
  Save,
  RotateCcw,
  History,
  Plus,
  CheckCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  GitCompare,
} from 'lucide-react';
import Layout from '@/components/Layout';
import Loading from '@/components/Loading';
import Modal from '@/components/Modal';
import { useAppStore } from '@/store';
import { useToast } from '@/contexts/ToastContext';
import rulesModule from '@/modules/rules';
import auditModule from '@/modules/audit';
import type { RuleConfig, RuleVersion } from '@/types';

interface EditableRule extends RuleConfig {
  isEditing?: boolean;
}

export default function RulesPage() {
  const {
    ruleVersions,
    activeRuleVersion,
    setActiveRuleVersion,
    loadRuleVersions,
    loading,
    currentBatchId,
    recordAuditLog,
    getCurrentStatsSnapshot,
    analyzeAnomalies,
    getCurrentBatch,
  } = useAppStore();
  const { showToast } = useToast();

  const [localRules, setLocalRules] = useState<EditableRule[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareVersion1, setCompareVersion1] = useState<string>('');
  const [compareVersion2, setCompareVersion2] = useState<string>('');
  const [newVersionName, setNewVersionName] = useState('');
  const [newVersionDesc, setNewVersionDesc] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sortedVersions = useMemo(() => {
    return [...ruleVersions].sort((a, b) => b.version - a.version);
  }, [ruleVersions]);

  const handleEditRule = (ruleId: string) => {
    setLocalRules(prev =>
      prev.map(r => (r.id === ruleId ? { ...r, isEditing: true } : r))
    );
  };

  const handleCancelEdit = (ruleId: string) => {
    if (activeRuleVersion) {
      const originalRule = activeRuleVersion.rules.find(r => r.id === ruleId);
      if (originalRule) {
        setLocalRules(prev =>
          prev.map(r => (r.id === ruleId ? { ...originalRule, isEditing: false } : r))
        );
      }
    }
    checkForChanges();
  };

  const handleRuleChange = (ruleId: string, field: string, value: any) => {
    setLocalRules(prev =>
      prev.map(r => {
        if (r.id !== ruleId) return r;
        if (field === 'enabled') {
          return { ...r, enabled: value };
        }
        if (field === 'severity') {
          return { ...r, severity: value };
        }
        if (field.startsWith('params.')) {
          const paramKey = field.replace('params.', '');
          return {
            ...r,
            params: { ...r.params, [paramKey]: value },
          };
        }
        return r;
      })
    );
    setHasChanges(true);
  };

  const handleSaveEdit = (ruleId: string) => {
    setLocalRules(prev =>
      prev.map(r => (r.id === ruleId ? { ...r, isEditing: false } : r))
    );
    checkForChanges();
  };

  const checkForChanges = () => {
    if (!activeRuleVersion) return;
    const hasDiff = localRules.some(localRule => {
      const originalRule = activeRuleVersion.rules.find(r => r.id === localRule.id);
      if (!originalRule) return true;
      return (
        localRule.enabled !== originalRule.enabled ||
        localRule.severity !== originalRule.severity ||
        JSON.stringify(localRule.params) !== JSON.stringify(originalRule.params)
      );
    });
    setHasChanges(hasDiff);
  };

  const handleSaveNewVersion = async () => {
    if (!newVersionName.trim()) {
      showToast('error', '请输入版本名称');
      return;
    }
    if (!currentBatchId) {
      showToast('warning', '请先选择一个批次');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    const oldVersion = activeRuleVersion;
    let success = false;
    let errorMessage: string | undefined;
    let newVersion: import('../types').RuleVersion | null = null;

    setIsSaving(true);
    try {
      const rulesToSave = localRules.map(({ isEditing, ...rule }) => rule);
      newVersion = await rulesModule.createRuleVersion(
        newVersionName.trim(),
        rulesToSave,
        newVersionDesc.trim()
      );
      await loadRuleVersions();
      if (newVersion) {
        await setActiveRuleVersion(newVersion.id);
        await analyzeAnomalies();
      }
      setShowSaveModal(false);
      setNewVersionName('');
      setNewVersionDesc('');
      setHasChanges(false);
      showToast('success', '新版本保存成功并已激活');
      success = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '保存新版本失败';
      showToast('error', errorMessage);
    } finally {
      setIsSaving(false);
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'rule_switch',
        description: `创建并激活新规则版本：${newVersionName.trim()}，描述：${newVersionDesc.trim() || '无'}`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          oldVersionId: oldVersion?.id,
          oldVersionName: oldVersion?.name,
          newVersionId: newVersion?.id,
          newVersionName: newVersionName.trim(),
          newVersionDesc: newVersionDesc.trim(),
        },
        linkedEntityIds: {
          ruleVersionIds: newVersion ? [newVersion.id] : [],
        },
      });
    }
  };

  const handleRollback = async (versionId: string) => {
    if (!currentBatchId) {
      showToast('warning', '请先选择一个批次');
      return;
    }
    if (!confirm('确定要回滚到此版本吗？这将创建一个新的版本并激活它。')) return;

    const statsBefore = getCurrentStatsSnapshot();
    const oldVersion = activeRuleVersion;
    const rollbackVersion = ruleVersions.find(v => v.id === versionId);
    let success = false;
    let errorMessage: string | undefined;
    let newVersion: import('../types').RuleVersion | null = null;

    try {
      newVersion = await rulesModule.rollbackToVersion(versionId);
      await loadRuleVersions();
      if (newVersion) {
        await setActiveRuleVersion(newVersion.id);
        await analyzeAnomalies();
      }
      showToast('success', '回滚成功');
      success = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '回滚失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'rule_switch',
        description: `回滚规则版本：从 ${oldVersion?.name || '无'} 回滚到 ${rollbackVersion?.name || versionId}（创建新版本）`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          oldVersionId: oldVersion?.id,
          oldVersionName: oldVersion?.name,
          rollbackFromVersionId: versionId,
          rollbackFromVersionName: rollbackVersion?.name,
          newVersionId: newVersion?.id,
        },
        linkedEntityIds: {
          ruleVersionIds: newVersion ? [newVersion.id, versionId] : [versionId],
        },
      });
    }
  };

  const handleActivateVersion = async (versionId: string) => {
    if (!currentBatchId) {
      showToast('warning', '请先选择一个批次');
      return;
    }

    const statsBefore = getCurrentStatsSnapshot();
    const oldVersion = activeRuleVersion;
    const newVersion = ruleVersions.find(v => v.id === versionId);
    let success = false;
    let errorMessage: string | undefined;

    try {
      await setActiveRuleVersion(versionId);
      await analyzeAnomalies();
      showToast('success', '版本已激活，异常已重新分析');
      success = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '激活失败';
      showToast('error', errorMessage);
    } finally {
      const statsAfter = getCurrentStatsSnapshot();
      await recordAuditLog({
        batchId: currentBatchId,
        action: 'rule_switch',
        description: `切换规则版本：${oldVersion?.name || '无'} → ${newVersion?.name || versionId}`,
        success,
        errorMessage,
        statsBefore,
        statsAfter,
        metadata: {
          oldVersionId: oldVersion?.id,
          oldVersionName: oldVersion?.name,
          newVersionId: versionId,
          newVersionName: newVersion?.name,
        },
        linkedEntityIds: {
          ruleVersionIds: [versionId],
        },
      });
    }
  };

  const handleReset = () => {
    if (activeRuleVersion) {
      setLocalRules(activeRuleVersion.rules.map(r => ({ ...r, isEditing: false })));
      setHasChanges(false);
    }
  };

  const getParamLabel = (key: string): string => {
    const labels: Record<string, string> = {
      gracePeriodMinutes: '宽限时间(分钟)',
      thresholdMinutes: '阈值(分钟)',
      requireBothPunches: '要求上下班打卡',
      maxCrossHours: '最大跨日时长(小时)',
      autoOffset: '自动抵扣',
      overtimeThresholdMinutes: '加班阈值(分钟)',
      expectedTimezone: '期望时区',
    };
    return labels[key] || key;
  };

  const renderParamInput = (
    rule: EditableRule,
    key: string,
    value: any,
    isEditing: boolean
  ) => {
    if (typeof value === 'boolean') {
      return (
        <select
          className="select-field w-40"
          value={value ? 'true' : 'false'}
          disabled={!isEditing}
          onChange={e =>
            handleRuleChange(rule.id, `params.${key}`, e.target.value === 'true')
          }
        >
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      );
    }
    if (typeof value === 'number') {
      return (
        <input
          type="number"
          className="input-field w-40"
          value={value}
          disabled={!isEditing}
          onChange={e =>
            handleRuleChange(rule.id, `params.${key}`, parseInt(e.target.value) || 0)
          }
        />
      );
    }
    return (
      <input
        type="text"
        className="input-field w-40"
        value={value}
        disabled={!isEditing}
        onChange={e => handleRuleChange(rule.id, `params.${key}`, e.target.value)}
      />
    );
  };

  const getCompareData = () => {
    const v1 = ruleVersions.find(v => v.id === compareVersion1);
    const v2 = ruleVersions.find(v => v.id === compareVersion2);
    if (!v1 || !v2) return [];

    const allRuleIds = new Set([
      ...v1.rules.map(r => r.id),
      ...v2.rules.map(r => r.id),
    ]);

    const differences: Array<{
      ruleName: string;
      field: string;
      v1Value: string;
      v2Value: string;
      type: 'added' | 'removed' | 'modified';
    }> = [];

    allRuleIds.forEach(ruleId => {
      const rule1 = v1.rules.find(r => r.id === ruleId);
      const rule2 = v2.rules.find(r => r.id === ruleId);

      if (!rule1 && rule2) {
        differences.push({
          ruleName: rule2.name,
          field: '规则',
          v1Value: '-',
          v2Value: '新增',
          type: 'added',
        });
      } else if (rule1 && !rule2) {
        differences.push({
          ruleName: rule1.name,
          field: '规则',
          v1Value: '存在',
          v2Value: '-',
          type: 'removed',
        });
      } else if (rule1 && rule2) {
        if (rule1.enabled !== rule2.enabled) {
          differences.push({
            ruleName: rule1.name,
            field: '启用状态',
            v1Value: rule1.enabled ? '启用' : '禁用',
            v2Value: rule2.enabled ? '启用' : '禁用',
            type: 'modified',
          });
        }
        if (rule1.severity !== rule2.severity) {
          differences.push({
            ruleName: rule1.name,
            field: '严重程度',
            v1Value: rule1.severity,
            v2Value: rule2.severity,
            type: 'modified',
          });
        }
        if (JSON.stringify(rule1.params) !== JSON.stringify(rule2.params)) {
          const allParams = new Set([
            ...Object.keys(rule1.params),
            ...Object.keys(rule2.params),
          ]);
          allParams.forEach(param => {
            const p1 = JSON.stringify(rule1.params[param]);
            const p2 = JSON.stringify(rule2.params[param]);
            if (p1 !== p2) {
              differences.push({
                ruleName: rule1.name,
                field: `参数: ${getParamLabel(param)}`,
                v1Value: rule1.params[param]?.toString() || '-',
                v2Value: rule2.params[param]?.toString() || '-',
                type: 'modified',
              });
            }
          });
        }
      }
    });

    return differences;
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <Loading size="lg" text="加载中..." />
        </div>
      </Layout>
    );
  }

  if (!activeRuleVersion && localRules.length === 0) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-96">
          <Settings size={48} className="text-[#f97316] mb-4" />
          <h3 className="text-xl font-semibold text-slate-800 mb-2">暂无规则配置</h3>
          <p className="text-slate-500">系统正在初始化规则...</p>
        </div>
      </Layout>
    );
  }

  if (localRules.length === 0 && activeRuleVersion) {
    setLocalRules(activeRuleVersion.rules.map(r => ({ ...r, isEditing: false })));
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">规则配置</h3>
            <p className="text-sm text-slate-500">
              当前版本: v{activeRuleVersion?.version} - {activeRuleVersion?.name}
            </p>
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => setShowHistory(true)}>
              <History size={16} className="inline mr-1" />
              版本历史
            </button>
            {hasChanges && (
              <button className="btn-secondary" onClick={handleReset}>
                <RotateCcw size={16} className="inline mr-1" />
                重置
              </button>
            )}
            <button
              className="btn-primary"
              onClick={() => {
                setNewVersionName(`v${(sortedVersions[0]?.version || 0) + 1}`);
                setShowSaveModal(true);
              }}
              disabled={!hasChanges}
            >
              <Save size={16} className="inline mr-1" />
              保存新版本
            </button>
          </div>
        </div>

        {hasChanges && (
          <div className="bg-[#f97316]/10 border border-[#f97316]/30 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle size={20} className="text-[#f97316] flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#f97316]">有未保存的更改</p>
              <p className="text-xs text-slate-600">
                修改后的规则需要保存为新版本才能生效
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {localRules.map(rule => {
            const isExpanded = expandedRule === rule.id;
            const isEditing = rule.isEditing;

            return (
              <div key={rule.id} className="card overflow-hidden">
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                >
                  <div className="flex items-center gap-4">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleRuleChange(rule.id, 'enabled', !rule.enabled);
                      }}
                    >
                      {rule.enabled ? (
                        <ToggleRight size={28} className="text-[#1e3a5f]" />
                      ) : (
                        <ToggleLeft size={28} className="text-slate-400" />
                      )}
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-800">{rule.name}</h4>
                        <span
                          className={`badge ${
                            rule.severity === 'critical'
                              ? 'badge-danger'
                              : rule.severity === 'high'
                              ? 'badge-danger'
                              : rule.severity === 'medium'
                              ? 'badge-warning'
                              : 'badge-success'
                          }`}
                        >
                          {rule.severity === 'critical'
                            ? '严重'
                            : rule.severity === 'high'
                            ? '高'
                            : rule.severity === 'medium'
                            ? '中'
                            : '低'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">{rule.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                          onClick={e => {
                            e.stopPropagation();
                            handleSaveEdit(rule.id);
                          }}
                        >
                          <CheckCircle size={18} className="text-green-600" />
                        </button>
                        <button
                          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                          onClick={e => {
                            e.stopPropagation();
                            handleCancelEdit(rule.id);
                          }}
                        >
                          <X size={18} className="text-red-600" />
                        </button>
                      </>
                    ) : (
                      <button
                        className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                        onClick={e => {
                          e.stopPropagation();
                          handleEditRule(rule.id);
                        }}
                      >
                        <Edit3 size={18} className="text-slate-600" />
                      </button>
                    )}
                    {isExpanded ? (
                      <ChevronUp size={20} className="text-slate-400" />
                    ) : (
                      <ChevronDown size={20} className="text-slate-400" />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 p-4 bg-slate-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          严重程度
                        </label>
                        <select
                          className="select-field"
                          value={rule.severity}
                          disabled={!isEditing}
                          onChange={e =>
                            handleRuleChange(rule.id, 'severity', e.target.value)
                          }
                        >
                          <option value="low">低</option>
                          <option value="medium">中</option>
                          <option value="high">高</option>
                          <option value="critical">严重</option>
                        </select>
                      </div>

                      <div className="space-y-3">
                        <h5 className="text-sm font-medium text-slate-700">规则参数</h5>
                        {Object.entries(rule.params).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-center justify-between"
                          >
                            <span className="text-sm text-slate-600">
                              {getParamLabel(key)}
                            </span>
                            {renderParamInput(rule, key, value, isEditing)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        title="版本历史"
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">
              共 {sortedVersions.length} 个版本
            </p>
            <button
              className="btn-secondary text-sm"
              onClick={() => {
                setCompareVersion1('');
                setCompareVersion2('');
                setShowCompareModal(true);
              }}
            >
              <GitCompare size={14} className="inline mr-1" />
              版本对比
            </button>
          </div>

          <div className="space-y-3">
            {sortedVersions.map((version, index) => (
              <div
                key={version.id}
                className={`p-4 rounded-lg border ${
                  version.isActive
                    ? 'border-[#1e3a5f] bg-[#1e3a5f]/5'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <div
                        className={`w-3 h-3 rounded-full mt-1.5 ${
                          version.isActive ? 'bg-[#1e3a5f]' : 'bg-slate-300'
                        }`}
                      />
                      {index < sortedVersions.length - 1 && (
                        <div className="absolute top-5 left-1.5 w-px h-full bg-slate-200" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-800">
                          v{version.version} - {version.name}
                        </h4>
                        {version.isActive && (
                          <span className="badge badge-info">当前版本</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        {version.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(version.createdAt).toLocaleString('zh-CN')}
                        </div>
                        <div>创建者: {version.createdBy}</div>
                        <div>{version.rules.length} 条规则</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!version.isActive && (
                      <>
                        <button
                          className="btn-secondary text-sm py-1 px-3"
                          onClick={() => handleActivateVersion(version.id)}
                        >
                          激活
                        </button>
                        <button
                          className="btn-secondary text-sm py-1 px-3"
                          onClick={() => handleRollback(version.id)}
                        >
                          <RotateCcw size={12} className="inline mr-1" />
                          回滚
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCompareModal}
        onClose={() => setShowCompareModal(false)}
        title="版本对比"
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                版本 1
              </label>
              <select
                className="select-field"
                value={compareVersion1}
                onChange={e => setCompareVersion1(e.target.value)}
              >
                <option value="">-- 选择版本 --</option>
                {sortedVersions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.version} - {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                版本 2
              </label>
              <select
                className="select-field"
                value={compareVersion2}
                onChange={e => setCompareVersion2(e.target.value)}
              >
                <option value="">-- 选择版本 --</option>
                {sortedVersions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.version} - {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {compareVersion1 && compareVersion2 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>规则</th>
                    <th>字段</th>
                    <th>版本 1</th>
                    <th>版本 2</th>
                    <th>变更类型</th>
                  </tr>
                </thead>
                <tbody>
                  {getCompareData().length > 0 ? (
                    getCompareData().map((diff, idx) => (
                      <tr key={idx}>
                        <td className="font-medium">{diff.ruleName}</td>
                        <td>{diff.field}</td>
                        <td
                          className={
                            diff.type === 'removed' ? 'text-red-600 line-through' : ''
                          }
                        >
                          {diff.v1Value}
                        </td>
                        <td
                          className={
                            diff.type === 'added' ? 'text-green-600 font-medium' : ''
                          }
                        >
                          {diff.v2Value}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              diff.type === 'added'
                                ? 'badge-success'
                                : diff.type === 'removed'
                                ? 'badge-danger'
                                : 'badge-warning'
                            }`}
                          >
                            {diff.type === 'added'
                              ? '新增'
                              : diff.type === 'removed'
                              ? '删除'
                              : '修改'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-8 text-slate-400"
                      >
                        两个版本完全相同，没有差异
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        title="保存新版本"
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setShowSaveModal(false)}
              disabled={isSaving}
            >
              取消
            </button>
            <button
              className="btn-primary"
              onClick={handleSaveNewVersion}
              disabled={isSaving || !newVersionName.trim()}
            >
              {isSaving ? (
                <>
                  <Loading size="sm" />
                  <span className="ml-2">保存中...</span>
                </>
              ) : (
                <>
                  <Save size={16} className="inline mr-1" />
                  保存
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              版本名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input-field"
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              placeholder="例如：优化迟到检测规则"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              版本描述
            </label>
            <textarea
              className="input-field min-h-24"
              value={newVersionDesc}
              onChange={e => setNewVersionDesc(e.target.value)}
              placeholder="描述本次规则变更的内容..."
            />
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <h5 className="font-medium text-slate-800 mb-2">变更摘要</h5>
            <div className="space-y-1 text-sm text-slate-600">
              {localRules.map((rule, idx) => {
                const original = activeRuleVersion?.rules.find(r => r.id === rule.id);
                if (!original) return null;
                const hasDiff =
                  rule.enabled !== original.enabled ||
                  rule.severity !== original.severity ||
                  JSON.stringify(rule.params) !== JSON.stringify(original.params);
                if (!hasDiff) return null;
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[#f97316]">•</span>
                    <span>{rule.name}</span>
                    {rule.enabled !== original.enabled && (
                      <span className="text-xs text-slate-500">
                        (状态: {original.enabled ? '启用' : '禁用'} →{' '}
                        {rule.enabled ? '启用' : '禁用'})
                      </span>
                    )}
                    {rule.severity !== original.severity && (
                      <span className="text-xs text-slate-500">
                        (严重程度: {original.severity} → {rule.severity})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
