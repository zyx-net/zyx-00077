import type {
  Anomaly,
  AnomalyType,
  StatsSummary,
} from '../../types';
import { getDateString, addDays, diffMinutes } from '../../utils/dateUtils';

export const calculateSummary = (anomalies: Anomaly[]): StatsSummary => {
  const totalRecords = anomalies.length;
  const totalAnomalies = anomalies.filter(a => a.type !== 'leave_offset').length;
  
  const anomaliesByType: Record<AnomalyType, number> = {
    late: 0,
    early_leave: 0,
    missing_punch: 0,
    missing_punch_in: 0,
    missing_punch_out: 0,
    cross_day: 0,
    duplicate: 0,
    leave_offset: 0,
    overtime: 0,
    timezone_error: 0,
    no_schedule: 0,
    no_punch: 0,
  };
  
  const anomaliesBySeverity: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  
  const anomaliesByDepartment: Record<string, number> = {};
  
  let pendingCorrections = 0;
  let correctedCount = 0;
  let ignoredCount = 0;
  let confirmedCount = 0;
  let totalResolutionMinutes = 0;
  let resolvedCount = 0;
  
  anomalies.forEach(anomaly => {
    anomaliesByType[anomaly.type] = (anomaliesByType[anomaly.type] || 0) + 1;
    anomaliesBySeverity[anomaly.severity] = (anomaliesBySeverity[anomaly.severity] || 0) + 1;
    
    if (anomaly.department) {
      anomaliesByDepartment[anomaly.department] = (anomaliesByDepartment[anomaly.department] || 0) + 1;
    }
    
    switch (anomaly.status) {
      case 'pending':
        pendingCorrections++;
        break;
      case 'corrected':
        correctedCount++;
        if (anomaly.createdAt && anomaly.correctedAt) {
          totalResolutionMinutes += diffMinutes(anomaly.createdAt, anomaly.correctedAt);
          resolvedCount++;
        }
        break;
      case 'ignored':
        ignoredCount++;
        if (anomaly.createdAt && anomaly.correctedAt) {
          totalResolutionMinutes += diffMinutes(anomaly.createdAt, anomaly.correctedAt);
          resolvedCount++;
        }
        break;
      case 'confirmed':
        confirmedCount++;
        if (anomaly.createdAt && anomaly.correctedAt) {
          totalResolutionMinutes += diffMinutes(anomaly.createdAt, anomaly.correctedAt);
          resolvedCount++;
        }
        break;
    }
  });
  
  const totalResolved = correctedCount + ignoredCount + confirmedCount;
  const resolutionRate = totalAnomalies > 0 ? (totalResolved / totalAnomalies) * 100 : 0;
  const averageResolutionMinutes = resolvedCount > 0 ? totalResolutionMinutes / resolvedCount : 0;
  
  return {
    totalRecords,
    totalAnomalies,
    anomaliesByType,
    anomaliesBySeverity,
    anomaliesByDepartment,
    pendingCorrections,
    correctedCount,
    ignoredCount,
    confirmedCount,
    resolutionRate,
    averageResolutionMinutes,
  };
};

export const groupByEmployee = (
  anomalies: Anomaly[]
): Record<string, Anomaly[]> => {
  const result: Record<string, Anomaly[]> = {};
  
  anomalies.forEach(anomaly => {
    const key = anomaly.employeeId;
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(anomaly);
  });
  
  return result;
};

export const groupByDate = (
  anomalies: Anomaly[]
): Record<string, Anomaly[]> => {
  const result: Record<string, Anomaly[]> = {};
  
  anomalies.forEach(anomaly => {
    const key = anomaly.scheduleDate;
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(anomaly);
  });
  
  return result;
};

export const groupByDepartment = (
  anomalies: Anomaly[]
): Record<string, Anomaly[]> => {
  const result: Record<string, Anomaly[]> = {};
  
  anomalies.forEach(anomaly => {
    const key = anomaly.department || '未分配';
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(anomaly);
  });
  
  return result;
};

export const groupByType = (
  anomalies: Anomaly[]
): Record<AnomalyType, Anomaly[]> => {
  const result = {} as Record<AnomalyType, Anomaly[]>;
  
  anomalies.forEach(anomaly => {
    if (!result[anomaly.type]) {
      result[anomaly.type] = [];
    }
    result[anomaly.type].push(anomaly);
  });
  
  return result;
};

export const groupByStatus = (
  anomalies: Anomaly[]
): Record<string, Anomaly[]> => {
  const result: Record<string, Anomaly[]> = {};
  
  anomalies.forEach(anomaly => {
    const key = anomaly.status;
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(anomaly);
  });
  
  return result;
};

export const calculateTrend = (
  anomalies: Anomaly[],
  days: number = 7
): Array<{ date: string; count: number }> => {
  const result: Array<{ date: string; count: number }> = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const dateStr = getDateString(date);
    const count = anomalies.filter(a => a.scheduleDate === dateStr).length;
    result.push({ date: dateStr, count });
  }
  
  return result;
};

export const getEmployeeStats = (
  anomalies: Anomaly[],
  topN: number = 10
): Array<{ employeeId: string; employeeName: string; count: number }> => {
  const grouped = groupByEmployee(anomalies);
  
  return Object.entries(grouped)
    .map(([employeeId, anomalyList]) => ({
      employeeId,
      employeeName: anomalyList[0]?.employeeName || employeeId,
      count: anomalyList.filter(a => a.type !== 'leave_offset').length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
};

export const getDepartmentStats = (
  anomalies: Anomaly[],
  topN: number = 10
): Array<{ department: string; count: number }> => {
  const grouped = groupByDepartment(anomalies);
  
  return Object.entries(grouped)
    .map(([department, anomalyList]) => ({
      department,
      count: anomalyList.filter(a => a.type !== 'leave_offset').length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
};

export const getSeverityDistribution = (
  anomalies: Anomaly[]
): Array<{ name: string; value: number; color: string }> => {
  const colors: Record<string, string> = {
    low: '#10b981',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
  };
  
  const labels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重',
  };
  
  const grouped = anomalies.reduce((acc, anomaly) => {
    acc[anomaly.severity] = (acc[anomaly.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return Object.entries(grouped).map(([severity, count]) => ({
    name: labels[severity] || severity,
    value: count,
    color: colors[severity] || '#6b7280',
  }));
};

export const getTypeDistribution = (
  anomalies: Anomaly[],
  labels: Record<AnomalyType, string>
): Array<{ name: string; value: number; type: AnomalyType }> => {
  const grouped = anomalies.reduce((acc, anomaly) => {
    if (anomaly.type !== 'leave_offset') {
      acc[anomaly.type] = (acc[anomaly.type] || 0) + 1;
    }
    return acc;
  }, {} as Record<AnomalyType, number>);
  
  return Object.entries(grouped)
    .map(([type, count]) => ({
      name: labels[type as AnomalyType] || type,
      value: count,
      type: type as AnomalyType,
    }))
    .sort((a, b) => b.value - a.value);
};

export const filterAnomalies = (
  anomalies: Anomaly[],
  filters: {
    type?: AnomalyType[];
    severity?: string[];
    status?: string[];
    department?: string[];
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }
): Anomaly[] => {
  return anomalies.filter(anomaly => {
    if (filters.type && filters.type.length > 0 && !filters.type.includes(anomaly.type)) {
      return false;
    }
    
    if (filters.severity && filters.severity.length > 0 && !filters.severity.includes(anomaly.severity)) {
      return false;
    }
    
    if (filters.status && filters.status.length > 0 && !filters.status.includes(anomaly.status)) {
      return false;
    }
    
    if (filters.department && filters.department.length > 0 && anomaly.department && !filters.department.includes(anomaly.department)) {
      return false;
    }
    
    if (filters.employeeId && anomaly.employeeId !== filters.employeeId) {
      return false;
    }
    
    if (filters.startDate && anomaly.scheduleDate < filters.startDate) {
      return false;
    }
    
    if (filters.endDate && anomaly.scheduleDate > filters.endDate) {
      return false;
    }
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matches = 
        anomaly.employeeName?.toLowerCase().includes(searchLower) ||
        anomaly.employeeId.toLowerCase().includes(searchLower) ||
        anomaly.description.toLowerCase().includes(searchLower) ||
        anomaly.department?.toLowerCase().includes(searchLower);
      if (!matches) return false;
    }
    
    return true;
  });
};

export const statsModule = {
  calculateSummary,
  groupByEmployee,
  groupByDate,
  groupByDepartment,
  groupByType,
  groupByStatus,
  calculateTrend,
  getEmployeeStats,
  getDepartmentStats,
  getSeverityDistribution,
  getTypeDistribution,
  filterAnomalies,
};

export default statsModule;
