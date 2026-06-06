import type {
  Anomaly,
  AnomalyType,
  RuleConfig,
  RuleVersion,
  MatchedRecord,
  RuleEngineResult,
  PunchRecord,
} from '../../types';
import { generateId, parseTime, diffMinutes, diffHours, formatTime, formatDuration, addDays, getDateString } from '../../utils/dateUtils';
import { ruleVersionOperations } from '../../db';

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  late: '迟到',
  early_leave: '早退',
  missing_punch: '缺卡',
  missing_punch_in: '缺上班打卡',
  missing_punch_out: '缺下班打卡',
  cross_day: '跨日班次',
  duplicate: '重复打卡',
  leave_offset: '调休抵扣',
  overtime: '加班',
  timezone_error: '时区错误',
  no_schedule: '无排班',
  no_punch: '无打卡记录',
};

export const ANOMALY_SEVERITY_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

export const createDefaultRules = (): RuleConfig[] => {
  return [
    {
      id: generateId(),
      name: '迟到检测',
      description: '检测上班打卡时间晚于排班开始时间的情况',
      anomalyType: 'late',
      enabled: true,
      params: {
        gracePeriodMinutes: 10,
        thresholdMinutes: 180,
      },
      severity: 'medium',
    },
    {
      id: generateId(),
      name: '早退检测',
      description: '检测下班打卡时间早于排班结束时间的情况',
      anomalyType: 'early_leave',
      enabled: true,
      params: {
        gracePeriodMinutes: 10,
        thresholdMinutes: 180,
      },
      severity: 'medium',
    },
    {
      id: generateId(),
      name: '缺卡检测',
      description: '检测缺少上班或下班打卡记录的情况',
      anomalyType: 'missing_punch',
      enabled: true,
      params: {
        requireBothPunches: true,
      },
      severity: 'high',
    },
    {
      id: generateId(),
      name: '重复打卡检测',
      description: '检测短时间内多次打卡的情况',
      anomalyType: 'duplicate',
      enabled: true,
      params: {
        thresholdMinutes: 5,
      },
      severity: 'low',
    },
    {
      id: generateId(),
      name: '跨日班次检测',
      description: '检测跨夜班次的打卡记录',
      anomalyType: 'cross_day',
      enabled: true,
      params: {
        maxCrossHours: 16,
      },
      severity: 'medium',
    },
    {
      id: generateId(),
      name: '调休抵扣检测',
      description: '检测有调休记录的日期，自动抵扣异常',
      anomalyType: 'leave_offset',
      enabled: true,
      params: {
        autoOffset: true,
      },
      severity: 'low',
    },
    {
      id: generateId(),
      name: '加班检测',
      description: '检测超出正常工作时间的情况',
      anomalyType: 'overtime',
      enabled: true,
      params: {
        overtimeThresholdMinutes: 30,
      },
      severity: 'low',
    },
    {
      id: generateId(),
      name: '时区错误检测',
      description: '检测打卡时间时区配置错误的情况',
      anomalyType: 'timezone_error',
      enabled: true,
      params: {
        expectedTimezone: 'Asia/Shanghai',
      },
      severity: 'high',
    },
    {
      id: generateId(),
      name: '无排班检测',
      description: '检测有打卡但无排班的情况',
      anomalyType: 'no_schedule',
      enabled: false,
      params: {},
      severity: 'medium',
    },
  ];
};

export const initializeRuleVersions = async (): Promise<RuleVersion> => {
  const existingVersions = await ruleVersionOperations.getAll();
  
  if (existingVersions.length === 0) {
    const defaultRules = createDefaultRules();
    const version: RuleVersion = {
      id: generateId(),
      version: 1,
      name: '初始规则版本',
      description: '系统默认初始化的规则配置',
      rules: defaultRules,
      isActive: true,
      createdAt: new Date(),
      createdBy: 'system',
    };
    
    await ruleVersionOperations.add(version);
    return version;
  }
  
  const activeVersion = existingVersions.find(v => v.isActive);
  if (activeVersion) {
    return activeVersion;
  }
  
  const latestVersion = existingVersions[existingVersions.length - 1];
  latestVersion.isActive = true;
  await ruleVersionOperations.update(latestVersion);
  return latestVersion;
};

export const createRuleVersion = async (
  name: string,
  rules: RuleConfig[],
  description: string
): Promise<RuleVersion> => {
  const maxVersion = await ruleVersionOperations.getMaxVersion();
  const version: RuleVersion = {
    id: generateId(),
    version: maxVersion + 1,
    name,
    description,
    rules: rules.map(r => ({ ...r, id: r.id || generateId() })),
    isActive: false,
    createdAt: new Date(),
    createdBy: 'user',
  };
  
  await ruleVersionOperations.add(version);
  return version;
};

export const activateRuleVersion = async (versionId: string): Promise<RuleVersion | null> => {
  await ruleVersionOperations.setActive(versionId);
  return ruleVersionOperations.getById(versionId);
};

export const rollbackToVersion = async (versionId: string): Promise<RuleVersion | null> => {
  const version = await ruleVersionOperations.getById(versionId);
  if (!version) return null;
  
  const newVersion: RuleVersion = {
    id: generateId(),
    version: (await ruleVersionOperations.getMaxVersion()) + 1,
    name: `${version.name} (回滚)`,
    description: `从版本 ${version.version} 回滚创建`,
    rules: version.rules.map(r => ({ ...r, id: generateId() })),
    isActive: false,
    createdAt: new Date(),
    createdBy: 'user',
  };
  
  await ruleVersionOperations.add(newVersion);
  await ruleVersionOperations.setActive(newVersion.id);
  
  return newVersion;
};

export const getRuleVersions = async (): Promise<RuleVersion[]> => {
  return ruleVersionOperations.getAll();
};

export const getActiveRuleVersion = async (): Promise<RuleVersion | null> => {
  return ruleVersionOperations.getActive();
};

export const detectLateArrival = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches } = record;
  const { gracePeriodMinutes = 10, thresholdMinutes = 180 } = params;
  
  const startDateTime = parseTime(schedule.startTime, schedule.scheduleDate);
  if (!startDateTime) return null;
  
  const inPunches = punches
    .filter(p => !p.metadata?.isDuplicate)
    .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  
  if (inPunches.length === 0) return null;
  
  const actualPunchIn = inPunches[0].punchTime;
  const lateMinutes = diffMinutes(startDateTime, actualPunchIn);
  
  if (lateMinutes > gracePeriodMinutes && lateMinutes <= thresholdMinutes) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'late',
      severity: lateMinutes > 60 ? 'high' : 'medium',
      description: `迟到 ${formatDuration(lateMinutes)}，排班上班时间 ${schedule.startTime}，实际打卡 ${formatTime(actualPunchIn)}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      actualPunchIn,
      scheduledStart: schedule.startTime,
      durationMinutes: lateMinutes,
      metadata: {
        scheduledStartTime: startDateTime.toISOString(),
        actualPunchTime: actualPunchIn.toISOString(),
        lateMinutes,
        gracePeriodMinutes,
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const detectEarlyLeave = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches } = record;
  const { gracePeriodMinutes = 10, thresholdMinutes = 180 } = params;
  
  let endDateTime = parseTime(schedule.endTime, schedule.scheduleDate);
  if (!endDateTime) return null;
  
  if (schedule.shiftType === 'crossDay') {
    endDateTime = parseTime(schedule.endTime, getDateString(addDays(schedule.scheduleDate, 1)));
  }
  
  const outPunches = punches
    .filter(p => !p.metadata?.isDuplicate)
    .sort((a, b) => b.punchTime.getTime() - a.punchTime.getTime());
  
  if (outPunches.length === 0) return null;
  
  const actualPunchOut = outPunches[0].punchTime;
  const earlyMinutes = diffMinutes(actualPunchOut, endDateTime!);
  
  if (earlyMinutes > gracePeriodMinutes && earlyMinutes <= thresholdMinutes) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'early_leave',
      severity: earlyMinutes > 60 ? 'high' : 'medium',
      description: `早退 ${formatDuration(earlyMinutes)}，排班下班时间 ${schedule.endTime}，实际打卡 ${formatTime(actualPunchOut)}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      actualPunchOut,
      scheduledEnd: schedule.endTime,
      durationMinutes: earlyMinutes,
      metadata: {
        scheduledEndTime: endDateTime!.toISOString(),
        actualPunchTime: actualPunchOut.toISOString(),
        earlyMinutes,
        gracePeriodMinutes,
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const detectMissingPunch = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly[] => {
  const { schedule, punches } = record;
  const { requireBothPunches = true } = params;
  const anomalies: Anomaly[] = [];
  
  const validPunches = punches.filter(p => !p.metadata?.isDuplicate);
  
  const hasPunchIn = validPunches.some(p => {
    const startDateTime = parseTime(schedule.startTime, schedule.scheduleDate);
    if (!startDateTime) return false;
    const diff = diffMinutes(startDateTime, p.punchTime);
    return diff >= -120 && diff <= 300;
  });
  
  let endDateTime = parseTime(schedule.endTime, schedule.scheduleDate);
  if (schedule.shiftType === 'crossDay') {
    endDateTime = parseTime(schedule.endTime, getDateString(addDays(schedule.scheduleDate, 1)));
  }
  
  const hasPunchOut = validPunches.some(p => {
    if (!endDateTime) return false;
    const diff = diffMinutes(p.punchTime, endDateTime);
    return diff >= -120 && diff <= 300;
  });
  
  if (requireBothPunches) {
    if (!hasPunchIn) {
      anomalies.push({
        id: generateId(),
        batchId: schedule.batchId,
        employeeId: schedule.employeeId,
        employeeName: schedule.employeeName,
        department: schedule.department,
        type: 'missing_punch_in',
        severity: 'high',
        description: `缺少上班打卡记录，排班上班时间 ${schedule.startTime}`,
        status: 'pending',
        ruleVersionId,
        scheduleDate: schedule.scheduleDate,
        scheduledStart: schedule.startTime,
        metadata: {
          scheduledStartTime: parseTime(schedule.startTime, schedule.scheduleDate)?.toISOString(),
        },
        createdAt: new Date(),
        matchedRecordId: record.id,
      });
    }
    
    if (!hasPunchOut) {
      anomalies.push({
        id: generateId(),
        batchId: schedule.batchId,
        employeeId: schedule.employeeId,
        employeeName: schedule.employeeName,
        department: schedule.department,
        type: 'missing_punch_out',
        severity: 'high',
        description: `缺少下班打卡记录，排班下班时间 ${schedule.endTime}`,
        status: 'pending',
        ruleVersionId,
        scheduleDate: schedule.scheduleDate,
        scheduledEnd: schedule.endTime,
        metadata: {
          scheduledEndTime: endDateTime?.toISOString(),
        },
        createdAt: new Date(),
        matchedRecordId: record.id,
      });
    }
  } else if (!hasPunchIn && !hasPunchOut) {
    anomalies.push({
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'missing_punch',
      severity: 'high',
      description: `缺少打卡记录，排班时间 ${schedule.startTime} - ${schedule.endTime}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      metadata: {
        scheduledStartTime: parseTime(schedule.startTime, schedule.scheduleDate)?.toISOString(),
        scheduledEndTime: endDateTime?.toISOString(),
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    });
  }
  
  return anomalies;
};

export const detectDuplicatePunches = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches } = record;
  const { thresholdMinutes = 5 } = params;
  
  const sortedPunches = [...punches].sort((a, b) => 
    a.punchTime.getTime() - b.punchTime.getTime()
  );
  
  const duplicates: PunchRecord[] = [];
  
  for (let i = 1; i < sortedPunches.length; i++) {
    const diff = diffMinutes(sortedPunches[i - 1].punchTime, sortedPunches[i].punchTime);
    if (diff <= thresholdMinutes) {
      duplicates.push(sortedPunches[i]);
    }
  }
  
  if (duplicates.length > 0) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'duplicate',
      severity: 'low',
      description: `检测到 ${duplicates.length} 条重复打卡记录，时间间隔小于 ${thresholdMinutes} 分钟`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      metadata: {
        duplicateCount: duplicates.length,
        thresholdMinutes,
        duplicateTimes: duplicates.map(d => formatTime(d.punchTime)),
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const detectCrossDayShift = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches } = record;
  const { maxCrossHours = 16 } = params;
  
  if (schedule.shiftType !== 'crossDay') return null;
  
  const startDateTime = parseTime(schedule.startTime, schedule.scheduleDate);
  const endDateTime = parseTime(schedule.endTime, getDateString(addDays(schedule.scheduleDate, 1)));
  
  if (!startDateTime || !endDateTime) return null;
  
  const shiftDuration = diffHours(startDateTime, endDateTime);
  const validPunches = punches.filter(p => !p.metadata?.isDuplicate);
  
  const punchDates = new Set(validPunches.map(p => getDateString(p.punchTime)));
  const hasCrossDayPunches = punchDates.size > 1;
  
  if (shiftDuration > 0 && shiftDuration <= maxCrossHours) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'cross_day',
      severity: 'medium',
      description: `跨日班次，工作时长 ${formatDuration(shiftDuration * 60)}，${hasCrossDayPunches ? '已正确识别跨日打卡' : '未检测到跨日打卡记录'}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      actualPunchIn: validPunches[0]?.punchTime,
      actualPunchOut: validPunches[validPunches.length - 1]?.punchTime,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      durationMinutes: shiftDuration * 60,
      metadata: {
        shiftDurationHours: shiftDuration,
        maxCrossHours,
        hasCrossDayPunches,
        punchDates: Array.from(punchDates),
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const detectLeaveOffset = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, leave } = record;
  const { autoOffset = true } = params;
  
  if (!leave) return null;
  
  return {
    id: generateId(),
    batchId: schedule.batchId,
    employeeId: schedule.employeeId,
    employeeName: schedule.employeeName,
    department: schedule.department,
    type: 'leave_offset',
    severity: 'low',
    description: `调休抵扣 ${leave.hours} 小时，类型：${leave.leaveType}${leave.reason ? `，原因：${leave.reason}` : ''}`,
    status: autoOffset ? 'corrected' : 'pending',
    ruleVersionId,
    scheduleDate: schedule.scheduleDate,
    metadata: {
      leaveType: leave.leaveType,
      leaveHours: leave.hours,
      leaveReason: leave.reason,
      autoOffset,
    },
    createdAt: new Date(),
    matchedRecordId: record.id,
  };
};

export const detectOvertime = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches, durationMinutes } = record;
  const { overtimeThresholdMinutes = 30 } = params;
  
  if (!durationMinutes || punches.length < 2) return null;
  
  const startDateTime = parseTime(schedule.startTime, schedule.scheduleDate);
  let endDateTime = parseTime(schedule.endTime, schedule.scheduleDate);
  
  if (!startDateTime || !endDateTime) return null;
  
  if (schedule.shiftType === 'crossDay') {
    endDateTime = parseTime(schedule.endTime, getDateString(addDays(schedule.scheduleDate, 1)));
  }
  
  const scheduledDuration = diffMinutes(startDateTime, endDateTime!);
  const overtimeMinutes = durationMinutes - scheduledDuration;
  
  if (overtimeMinutes > overtimeThresholdMinutes) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'overtime',
      severity: 'low',
      description: `加班 ${formatDuration(overtimeMinutes)}，排班时长 ${formatDuration(scheduledDuration)}，实际时长 ${formatDuration(durationMinutes)}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      actualPunchIn: record.workStartTime,
      actualPunchOut: record.workEndTime,
      scheduledStart: schedule.startTime,
      scheduledEnd: schedule.endTime,
      durationMinutes: overtimeMinutes,
      metadata: {
        scheduledDurationMinutes: scheduledDuration,
        actualDurationMinutes: durationMinutes,
        overtimeMinutes,
        overtimeThresholdMinutes,
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const detectTimezoneError = (
  record: MatchedRecord,
  params: any,
  ruleVersionId: string
): Anomaly | null => {
  const { schedule, punches } = record;
  const { expectedTimezone = 'Asia/Shanghai' } = params;
  
  const timezoneErrors = punches.filter(p => p.timezone !== expectedTimezone);
  
  if (timezoneErrors.length > 0) {
    return {
      id: generateId(),
      batchId: schedule.batchId,
      employeeId: schedule.employeeId,
      employeeName: schedule.employeeName,
      department: schedule.department,
      type: 'timezone_error',
      severity: 'high',
      description: `时区配置错误，检测到 ${timezoneErrors.length} 条记录时区为 ${timezoneErrors[0].timezone}，应为 ${expectedTimezone}`,
      status: 'pending',
      ruleVersionId,
      scheduleDate: schedule.scheduleDate,
      metadata: {
        expectedTimezone,
        actualTimezones: Array.from(new Set(timezoneErrors.map(p => p.timezone))),
        errorCount: timezoneErrors.length,
      },
      createdAt: new Date(),
      matchedRecordId: record.id,
    };
  }
  
  return null;
};

export const runAnomalyDetection = async (
  matchedRecords: MatchedRecord[],
  ruleVersionId?: string
): Promise<RuleEngineResult> => {
  const startTime = Date.now();
  
  let activeVersion: RuleVersion | null;
  if (ruleVersionId) {
    activeVersion = await ruleVersionOperations.getById(ruleVersionId);
  } else {
    activeVersion = await getActiveRuleVersion();
  }
  
  if (!activeVersion) {
    activeVersion = await initializeRuleVersions();
  }
  
  const enabledRules = activeVersion.rules.filter(r => r.enabled);
  const allAnomalies: Anomaly[] = [];
  
  const byType: Record<AnomalyType, number> = {
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
  
  const bySeverity: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  
  for (const record of matchedRecords) {
    for (const rule of enabledRules) {
      try {
        let anomalies: Anomaly | Anomaly[] | null = null;
        
        switch (rule.anomalyType) {
          case 'late':
            anomalies = detectLateArrival(record, rule.params, activeVersion.id);
            break;
          case 'early_leave':
            anomalies = detectEarlyLeave(record, rule.params, activeVersion.id);
            break;
          case 'missing_punch':
            anomalies = detectMissingPunch(record, rule.params, activeVersion.id);
            break;
          case 'duplicate':
            anomalies = detectDuplicatePunches(record, rule.params, activeVersion.id);
            break;
          case 'cross_day':
            anomalies = detectCrossDayShift(record, rule.params, activeVersion.id);
            break;
          case 'leave_offset':
            anomalies = detectLeaveOffset(record, rule.params, activeVersion.id);
            break;
          case 'overtime':
            anomalies = detectOvertime(record, rule.params, activeVersion.id);
            break;
          case 'timezone_error':
            anomalies = detectTimezoneError(record, rule.params, activeVersion.id);
            break;
        }
        
        if (anomalies) {
          const anomalyList = Array.isArray(anomalies) ? anomalies : [anomalies];
          anomalyList.forEach(a => {
            a.severity = rule.severity;
            allAnomalies.push(a);
            byType[a.type] = (byType[a.type] || 0) + 1;
            bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
          });
        }
      } catch (error) {
        console.error(`规则执行错误 ${rule.name}:`, error);
      }
    }
  }
  
  const durationMs = Date.now() - startTime;
  
  return {
    anomalies: allAnomalies,
    processedRecords: matchedRecords.length,
    ruleVersionId: activeVersion.id,
    durationMs,
    summary: {
      byType,
      bySeverity,
    },
  };
};

export const ruleModule = {
  ANOMALY_TYPE_LABELS,
  ANOMALY_SEVERITY_COLORS,
  createDefaultRules,
  initializeRuleVersions,
  createRuleVersion,
  activateRuleVersion,
  rollbackToVersion,
  getRuleVersions,
  getActiveRuleVersion,
  detectLateArrival,
  detectEarlyLeave,
  detectMissingPunch,
  detectDuplicatePunches,
  detectCrossDayShift,
  detectLeaveOffset,
  detectOvertime,
  detectTimezoneError,
  runAnomalyDetection,
};

export default ruleModule;
