import type {
  Anomaly,
  Correction,
  CorrectionResult,
} from '../../types';
import { generateId } from '../../utils/dateUtils';
import { anomalyOperations, correctionOperations } from '../../db';

export type CorrectionType = 
  | 'adjust_time'
  | 'mark_normal'
  | 'ignore'
  | 'confirm'
  | 'add_punch'
  | 'remove_punch'
  | 'change_schedule'
  | 'apply_leave'
  | 'custom';

export const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
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

export const correctAnomaly = async (
  anomalyId: string,
  correctionType: CorrectionType,
  newValue: any,
  reason: string
): Promise<CorrectionResult> => {
  try {
    const anomaly = await anomalyOperations.getById(anomalyId);
    if (!anomaly) {
      return {
        success: false,
        anomalyId,
        correction: {} as Correction,
      };
    }
    
    const oldValue = JSON.stringify({
      status: anomaly.status,
      durationMinutes: anomaly.durationMinutes,
      actualPunchIn: anomaly.actualPunchIn,
      actualPunchOut: anomaly.actualPunchOut,
    });
    
    const correction: Correction = {
      id: generateId(),
      anomalyId,
      batchId: anomaly.batchId,
      type: correctionType,
      oldValue,
      newValue: JSON.stringify(newValue),
      reason,
      createdAt: new Date(),
      createdBy: 'user',
      ruleVersionId: anomaly.ruleVersionId,
    };
    
    switch (correctionType) {
      case 'adjust_time':
        if (newValue.punchIn) {
          anomaly.actualPunchIn = new Date(newValue.punchIn);
        }
        if (newValue.punchOut) {
          anomaly.actualPunchOut = new Date(newValue.punchOut);
        }
        if (newValue.durationMinutes !== undefined) {
          anomaly.durationMinutes = newValue.durationMinutes;
        }
        anomaly.status = 'corrected';
        anomaly.description = `已修正：${reason}。原异常：${anomaly.description}`;
        break;
        
      case 'mark_normal':
        anomaly.status = 'corrected';
        anomaly.description = `已标记为正常：${reason}。原异常：${anomaly.description}`;
        break;
        
      case 'ignore':
        anomaly.status = 'ignored';
        anomaly.description = `已忽略：${reason}。原异常：${anomaly.description}`;
        break;
        
      case 'confirm':
        anomaly.status = 'confirmed';
        anomaly.description = `已确认异常：${reason}。${anomaly.description}`;
        break;
        
      case 'add_punch':
        if (newValue.punchTime) {
          if (newValue.punchType === 'in') {
            anomaly.actualPunchIn = new Date(newValue.punchTime);
          } else if (newValue.punchType === 'out') {
            anomaly.actualPunchOut = new Date(newValue.punchTime);
          }
        }
        anomaly.status = 'corrected';
        anomaly.description = `已补卡：${reason}。原异常：${anomaly.description}`;
        break;
        
      case 'change_schedule':
        if (newValue.startTime) {
          anomaly.scheduledStart = newValue.startTime;
        }
        if (newValue.endTime) {
          anomaly.scheduledEnd = newValue.endTime;
        }
        anomaly.status = 'corrected';
        anomaly.description = `已调整排班：${reason}。原异常：${anomaly.description}`;
        break;
        
      case 'apply_leave':
        anomaly.status = 'corrected';
        anomaly.description = `已申请请假：${reason}。原异常：${anomaly.description}`;
        anomaly.metadata = {
          ...anomaly.metadata,
          leaveApplied: true,
          leaveType: newValue.leaveType,
          leaveHours: newValue.hours,
        };
        break;
        
      case 'custom':
        anomaly.status = newValue.status || 'corrected';
        if (newValue.description) {
          anomaly.description = newValue.description;
        }
        break;
    }
    
    anomaly.correctedAt = new Date();
    anomaly.correctionId = correction.id;
    
    await correctionOperations.add(correction);
    const updatedId = await anomalyOperations.update(anomaly);
    
    return {
      success: true,
      anomalyId,
      correction,
      updatedAnomaly: updatedId ? anomaly : undefined,
    };
  } catch (error) {
    console.error('修正异常失败:', error);
    return {
      success: false,
      anomalyId,
      correction: {} as Correction,
    };
  }
};

export const batchCorrect = async (
  anomalyIds: string[],
  correctionType: CorrectionType,
  newValue: any,
  reason: string
): Promise<CorrectionResult[]> => {
  const results: CorrectionResult[] = [];
  
  for (const anomalyId of anomalyIds) {
    const result = await correctAnomaly(anomalyId, correctionType, newValue, reason);
    results.push(result);
  }
  
  return results;
};

export const ignoreAnomaly = async (
  anomalyId: string,
  reason: string
): Promise<CorrectionResult> => {
  return correctAnomaly(anomalyId, 'ignore', {}, reason);
};

export const confirmAnomaly = async (
  anomalyId: string
): Promise<CorrectionResult> => {
  return correctAnomaly(anomalyId, 'confirm', {}, '确认异常属实');
};

export const getCorrectionHistory = async (
  anomalyId: string
): Promise<Correction[]> => {
  return correctionOperations.getByAnomalyId(anomalyId);
};

export const getBatchCorrections = async (
  batchId: string
): Promise<Correction[]> => {
  return correctionOperations.getByBatchId(batchId);
};

export const revertCorrection = async (
  correctionId: string
): Promise<boolean> => {
  try {
    const corrections = await correctionOperations.getByBatchId('');
    const correction = corrections.find(c => c.id === correctionId);
    if (!correction) return false;
    
    const anomaly = await anomalyOperations.getById(correction.anomalyId);
    if (!anomaly) return false;
    
    try {
      const oldValue = JSON.parse(correction.oldValue);
      anomaly.status = oldValue.status;
      if (oldValue.durationMinutes !== undefined) {
        anomaly.durationMinutes = oldValue.durationMinutes;
      }
      if (oldValue.actualPunchIn) {
        anomaly.actualPunchIn = new Date(oldValue.actualPunchIn);
      }
      if (oldValue.actualPunchOut) {
        anomaly.actualPunchOut = new Date(oldValue.actualPunchOut);
      }
      anomaly.correctedAt = undefined;
      anomaly.correctionId = undefined;
      
      await anomalyOperations.update(anomaly);
      return true;
    } catch {
      return false;
    }
  } catch (error) {
    console.error('撤销修正失败:', error);
    return false;
  }
};

export const correctionModule = {
  CORRECTION_TYPE_LABELS,
  correctAnomaly,
  batchCorrect,
  ignoreAnomaly,
  confirmAnomaly,
  getCorrectionHistory,
  getBatchCorrections,
  revertCorrection,
};

export default correctionModule;
