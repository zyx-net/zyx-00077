import type {
  Appeal,
  AppealStatus,
  AppealConflict,
  AppealCreateParams,
  AppealReviewParams,
  AppealStateSummary,
  AppealEvidence,
  Anomaly,
  Batch,
  Correction,
} from '../../types';
import { generateId } from '../../utils/dateUtils';
import {
  appealOperations,
  anomalyOperations,
  batchOperations,
  correctionOperations,
} from '../../db';
import { correctAnomaly, type CorrectionType } from '../correction';

export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  revoked: '已撤销',
};

export const APPEAL_STATUS_COLORS: Record<AppealStatus, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
  revoked: '#6b7280',
};

export const VALID_TRANSITIONS: Record<AppealStatus, AppealStatus[]> = {
  pending: ['approved', 'rejected', 'revoked'],
  approved: [],
  rejected: [],
  revoked: [],
};

export const canTransition = (from: AppealStatus, to: AppealStatus): boolean => {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
};

export const checkConflicts = async (
  anomalyId: string
): Promise<AppealConflict[]> => {
  const conflicts: AppealConflict[] = [];

  const anomaly = await anomalyOperations.getById(anomalyId);
  if (!anomaly) {
    conflicts.push({
      type: 'anomaly_not_found',
      message: '异常不存在',
      severity: 'error',
    });
    return conflicts;
  }

  const batch = await batchOperations.getById(anomaly.batchId);
  if (!batch) {
    conflicts.push({
      type: 'batch_deleted',
      message: '批次已被删除',
      severity: 'error',
      details: { batchId: anomaly.batchId },
    });
    return conflicts;
  }

  if (anomaly.status !== 'pending') {
    conflicts.push({
      type: 'anomaly_already_corrected',
      message: '该异常已被修正，无法发起申诉',
      severity: 'error',
      details: { anomalyStatus: anomaly.status },
    });
  }

  const pendingAppeal = await appealOperations.getPendingByAnomalyId(anomalyId);
  if (pendingAppeal) {
    conflicts.push({
      type: 'pending_appeal_exists',
      message: '该异常已有待处理的申诉',
      severity: 'error',
      details: { appealId: pendingAppeal.id },
    });
  }

  return conflicts;
};

export const checkReviewConflicts = async (
  appealId: string,
  targetStatus: AppealStatus
): Promise<AppealConflict[]> => {
  const conflicts: AppealConflict[] = [];

  const appeal = await appealOperations.getById(appealId);
  if (!appeal) {
    conflicts.push({
      type: 'anomaly_not_found',
      message: '申诉记录不存在',
      severity: 'error',
    });
    return conflicts;
  }

  if (!canTransition(appeal.status, targetStatus)) {
    conflicts.push({
      type: 'invalid_state_transition',
      message: '状态流转无效',
      severity: 'error',
      details: { from: appeal.status, to: targetStatus },
    });
  }

  const anomaly = await anomalyOperations.getById(appeal.anomalyId);
  if (!anomaly) {
    conflicts.push({
      type: 'anomaly_not_found',
      message: '关联的异常记录已不存在',
      severity: 'error',
    });
    return conflicts;
  }

  if (targetStatus === 'approved' && anomaly.status !== 'pending') {
    conflicts.push({
      type: 'anomaly_already_corrected',
      message: '异常已被修正，无法通过申诉',
      severity: 'error',
      details: { anomalyStatus: anomaly.status },
    });
  }

  const batch = await batchOperations.getById(appeal.batchId);
  if (!batch) {
    conflicts.push({
      type: 'batch_deleted',
      message: '所属批次已被删除',
      severity: 'error',
      details: { batchId: appeal.batchId },
    });
  }

  return conflicts;
};

export const createAppeal = async (
  params: AppealCreateParams
): Promise<{
  success: boolean;
  appeal?: Appeal;
  conflicts?: AppealConflict[];
  correction?: Correction;
}> => {
  try {
    const conflicts = await checkConflicts(params.anomalyId);
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    const anomaly = await anomalyOperations.getById(params.anomalyId);
    if (!anomaly) {
      return {
      success: false,
      conflicts: [{ type: 'anomaly_not_found', message: '异常记录不存在', severity: 'error' }],
    };
    }

    const evidence: AppealEvidence[] = (params.evidence || []).map(e => ({
      ...e,
      id: generateId(),
      uploadedAt: new Date(),
    }));

    const appeal: Appeal = {
      id: generateId(),
      batchId: anomaly.batchId,
      anomalyId: anomaly.id,
      employeeId: anomaly.employeeId,
      employeeName: anomaly.employeeName,
      department: anomaly.department,
      anomalyType: anomaly.type,
      anomalyDescription: anomaly.description,
      scheduleDate: anomaly.scheduleDate,
      reason: params.reason,
      status: 'pending',
      correctionType: params.correctionType,
      correctionValue: params.correctionValue,
      evidence,
      createdBy: params.operator || 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    await appealOperations.add(appeal);

    return { success: true, appeal };
  } catch (error) {
    console.error('创建申诉失败:', error);
    return {
      success: false,
      conflicts: [{
        type: 'anomaly_not_found',
        message: error instanceof Error ? error.message : '创建申诉失败',
        severity: 'error',
      }],
    };
  }
};

export const approveAppeal = async (
  params: AppealReviewParams
): Promise<{
  success: boolean;
  appeal?: Appeal;
  conflicts?: AppealConflict[];
  correction?: Correction;
}> => {
  try {
    const conflicts = await checkReviewConflicts(params.appealId, 'approved');
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    const appeal = await appealOperations.getById(params.appealId);
    if (!appeal) {
      return {
        success: false,
        conflicts: [{ type: 'anomaly_not_found', message: '申诉记录不存在', severity: 'error' }],
      };
    }

    const stateSummary: AppealStateSummary = {
      statusBefore: appeal.status,
      statusAfter: 'approved',
    };

    let correction: Correction | undefined;
    if (appeal.correctionType) {
      const correctionResult = await correctAnomaly(
        appeal.anomalyId,
        appeal.correctionType as CorrectionType,
        appeal.correctionValue || {},
        `申诉通过：${appeal.reason}。审批意见：${params.comment}`
      );

      if (!correctionResult.success || !correctionResult.correction) {
        return {
          success: false,
          conflicts: [{
          type: 'anomaly_not_found',
          message: '自动生成修正记录失败',
          severity: 'error',
        }],
        };
      }

      correction = correctionResult.correction;
      appeal.correctionId = correction.id;
    }

    appeal.status = 'approved';
    appeal.reviewedBy = params.operator || 'user';
    appeal.reviewedAt = new Date();
    appeal.reviewComment = params.comment;
    appeal.updatedAt = new Date();
    appeal.metadata = {
      ...appeal.metadata,
      stateTransition: stateSummary,
      autoCorrected: !!appeal.correctionType,
    };

    await appealOperations.update(appeal);

    return { success: true, appeal, correction };
  } catch (error) {
    console.error('审批申诉失败:', error);
    return {
      success: false,
      conflicts: [{
        type: 'anomaly_not_found',
        message: error instanceof Error ? error.message : '审批申诉失败',
        severity: 'error',
      }],
    };
  }
};

export const rejectAppeal = async (
  params: AppealReviewParams
): Promise<{
  success: boolean;
  appeal?: Appeal;
  conflicts?: AppealConflict[];
}> => {
  try {
    const conflicts = await checkReviewConflicts(params.appealId, 'rejected');
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    const appeal = await appealOperations.getById(params.appealId);
    if (!appeal) {
      return {
        success: false,
        conflicts: [{ type: 'anomaly_not_found', message: '申诉记录不存在', severity: 'error' }],
      };
    }

    const stateSummary: AppealStateSummary = {
      statusBefore: appeal.status,
      statusAfter: 'rejected',
    };

    appeal.status = 'rejected';
    appeal.reviewedBy = params.operator || 'user';
    appeal.reviewedAt = new Date();
    appeal.reviewComment = params.comment;
    appeal.updatedAt = new Date();
    appeal.metadata = {
      ...appeal.metadata,
      stateTransition: stateSummary,
    };

    await appealOperations.update(appeal);

    return { success: true, appeal };
  } catch (error) {
    console.error('驳回申诉失败:', error);
    return {
      success: false,
      conflicts: [{
        type: 'anomaly_not_found',
        message: error instanceof Error ? error.message : '驳回申诉失败',
        severity: 'error',
      }],
    };
  }
};

export const revokeAppeal = async (
  appealId: string,
  operator?: string
): Promise<{
  success: boolean;
  appeal?: Appeal;
  conflicts?: AppealConflict[];
}> => {
  try {
    const conflicts = await checkReviewConflicts(appealId, 'revoked');
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    const appeal = await appealOperations.getById(appealId);
    if (!appeal) {
      return {
        success: false,
        conflicts: [{ type: 'anomaly_not_found', message: '申诉记录不存在', severity: 'error' }],
      };
    }

    const stateSummary: AppealStateSummary = {
      statusBefore: appeal.status,
      statusAfter: 'revoked',
    };

    appeal.status = 'revoked';
    appeal.reviewedBy = operator || 'user';
    appeal.reviewedAt = new Date();
    appeal.reviewComment = '申诉人撤销';
    appeal.updatedAt = new Date();
    appeal.metadata = {
      ...appeal.metadata,
      stateTransition: stateSummary,
    };

    await appealOperations.update(appeal);

    return { success: true, appeal };
  } catch (error) {
    console.error('撤销申诉失败:', error);
    return {
      success: false,
      conflicts: [{
        type: 'anomaly_not_found',
        message: error instanceof Error ? error.message : '撤销申诉失败',
        severity: 'error',
      }],
    };
  }
};

export const getAppealsByBatchId = async (
  batchId: string,
  status?: AppealStatus
): Promise<Appeal[]> => {
  if (status) {
    return appealOperations.getByBatchIdAndStatus(batchId, status);
  }
  return appealOperations.getByBatchId(batchId);
};

export const getAppealById = async (id: string): Promise<Appeal | undefined> => {
  return appealOperations.getById(id);
};

export const getAppealsByAnomalyId = async (anomalyId: string): Promise<Appeal[]> => {
  return appealOperations.getByAnomalyId(anomalyId);
};

export const generateAppealCSV = (appeals: Appeal[]): string => {
  if (appeals.length === 0) return '';

  const headers = [
    '申诉编号',
    '员工编号',
    '员工姓名',
    '部门',
    '申诉日期',
    '异常日期',
    '异常类型',
    '异常描述',
    '申诉原因',
    '状态',
    '审批人',
    '审批时间',
    '审批意见',
    '修正类型',
    '证据数量',
  ];

  const ANOMALY_TYPE_LABELS: Record<string, string> = {
    late: '迟到',
    early_leave: '早退',
    missing_punch: '缺卡',
    missing_punch_in: '缺上班卡',
    missing_punch_out: '缺下班卡',
    cross_day: '跨日班次',
    duplicate: '重复打卡',
    leave_offset: '调休抵扣',
    overtime: '加班',
    timezone_error: '时区错误',
    no_schedule: '无排班',
    no_punch: '无打卡',
  };

  const CORRECTION_TYPE_LABELS: Record<string, string> = {
    adjust_time: '调整时间',
    mark_normal: '标记为正常',
    ignore: '忽略',
    confirm: '确认异常',
    add_punch: '补卡',
    remove_punch: '删除打卡',
    change_schedule: '调整排班',
    apply_leave: '申请请假',
    custom: '自定义',
  };

  const rows = appeals.map(appeal => [
    appeal.id,
    appeal.employeeId,
    `"${(appeal.employeeName || '').replace(/"/g, '""')}"`,
    `"${(appeal.department || '').replace(/"/g, '""')}"`,
    new Date(appeal.createdAt).toLocaleString('zh-CN'),
    appeal.scheduleDate,
    ANOMALY_TYPE_LABELS[appeal.anomalyType] || appeal.anomalyType,
    `"${appeal.anomalyDescription.replace(/"/g, '""')}"`,
    `"${appeal.reason.replace(/"/g, '""')}"`,
    APPEAL_STATUS_LABELS[appeal.status],
    appeal.reviewedBy || '',
    appeal.reviewedAt ? new Date(appeal.reviewedAt).toLocaleString('zh-CN') : '',
    appeal.reviewComment ? `"${appeal.reviewComment.replace(/"/g, '""')}"` : '',
    appeal.correctionType ? (CORRECTION_TYPE_LABELS[appeal.correctionType] || appeal.correctionType) : '',
    appeal.evidence.length,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const downloadAppealCSV = (appeals: Appeal[], filename?: string): void => {
  const csv = generateAppealCSV(appeals);
  if (!csv) return;

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `申诉记录_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const appealModule = {
  APPEAL_STATUS_LABELS,
  APPEAL_STATUS_COLORS,
  VALID_TRANSITIONS,
  canTransition,
  checkConflicts,
  checkReviewConflicts,
  createAppeal,
  approveAppeal,
  rejectAppeal,
  revokeAppeal,
  getAppealsByBatchId,
  getAppealById,
  getAppealsByAnomalyId,
  generateAppealCSV,
  downloadAppealCSV,
};

export default appealModule;
