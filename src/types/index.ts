export interface BatchStats {
  totalSchedules: number;
  totalPunches: number;
  totalLeaves: number;
  totalAnomalies: number;
  pendingAnomalies: number;
  correctedAnomalies: number;
}

export interface Batch {
  id: string;
  name: string;
  status: 'draft' | 'importing' | 'analyzing' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  fieldMapping: FieldMapping;
  stats: BatchStats;
  timezone: string;
}

export interface FieldMapping {
  schedule: Record<string, string>;
  punch: Record<string, string>;
  leave: Record<string, string>;
}

export interface ScheduleRecord {
  id: string;
  batchId: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  shiftType: 'normal' | 'night' | 'crossDay';
  breakStartTime?: string;
  breakEndTime?: string;
  rawData?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PunchRecord {
  id: string;
  batchId: string;
  employeeId: string;
  employeeName?: string;
  punchTime: Date;
  punchType: 'in' | 'out' | 'auto';
  deviceId?: string;
  location?: string;
  timezone: string;
  rawData?: Record<string, any>;
  originalTime?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LeaveRecord {
  id: string;
  batchId: string;
  employeeId: string;
  employeeName?: string;
  leaveDate: string;
  leaveType: 'annual' | 'sick' | 'personal' | 'overtime' | 'other';
  hours: number;
  startTime?: string;
  endTime?: string;
  reason?: string;
  rawData?: Record<string, any>;
}

export type AnomalyType =
  | 'late'
  | 'early_leave'
  | 'missing_punch'
  | 'missing_punch_in'
  | 'missing_punch_out'
  | 'cross_day'
  | 'duplicate'
  | 'leave_offset'
  | 'overtime'
  | 'timezone_error'
  | 'no_schedule'
  | 'no_punch';

export interface Anomaly {
  id: string;
  batchId: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  status: 'pending' | 'corrected' | 'ignored' | 'confirmed';
  ruleVersionId: string;
  scheduleDate: string;
  actualPunchIn?: Date;
  actualPunchOut?: Date;
  scheduledStart?: string;
  scheduledEnd?: string;
  durationMinutes?: number;
  metadata: Record<string, any>;
  createdAt: Date;
  correctedAt?: Date;
  correctionId?: string;
  matchedRecordId?: string;
}

export interface RuleConfig {
  id: string;
  name: string;
  description: string;
  anomalyType: AnomalyType;
  enabled: boolean;
  params: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RuleVersion {
  id: string;
  version: number;
  name: string;
  description: string;
  rules: RuleConfig[];
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
}

export interface Correction {
  id: string;
  anomalyId: string;
  batchId: string;
  type: string;
  oldValue: string;
  newValue: string;
  reason: string;
  createdAt: Date;
  createdBy: string;
  ruleVersionId?: string;
}

export interface MatchedRecord {
  id: string;
  schedule: ScheduleRecord;
  punches: PunchRecord[];
  leave?: LeaveRecord;
  date: string;
  employeeId: string;
  workStartTime?: Date;
  workEndTime?: Date;
  durationMinutes?: number;
}

export interface ImportResult<T> {
  success: boolean;
  data: T[];
  errors: ImportError[];
  warnings: string[];
  totalRows: number;
  validRows: number;
}

export interface ImportError {
  row: number;
  column: string;
  message: string;
  value: any;
  code: 'MISSING_REQUIRED' | 'INVALID_FORMAT' | 'INVALID_VALUE' | 'DUPLICATE';
}

export interface MatchResult {
  matched: MatchedRecord[];
  unmatchedSchedules: ScheduleRecord[];
  unmatchedPunches: PunchRecord[];
  summary: {
    totalSchedules: number;
    totalPunches: number;
    matchedCount: number;
    unmatchedSchedulesCount: number;
    unmatchedPunchesCount: number;
  };
}

export interface RuleEngineResult {
  anomalies: Anomaly[];
  processedRecords: number;
  ruleVersionId: string;
  durationMs: number;
  summary: {
    byType: Record<AnomalyType, number>;
    bySeverity: Record<string, number>;
  };
}

export interface CorrectionResult {
  success: boolean;
  anomalyId: string;
  correction: Correction;
  updatedAnomaly?: Anomaly;
}

export interface StatsSummary {
  totalRecords: number;
  totalAnomalies: number;
  anomaliesByType: Record<AnomalyType, number>;
  anomaliesBySeverity: Record<string, number>;
  anomaliesByDepartment: Record<string, number>;
  pendingCorrections: number;
  correctedCount: number;
  ignoredCount: number;
  confirmedCount: number;
  resolutionRate: number;
  averageResolutionMinutes: number;
}

export interface ExportOptions {
  format: 'html' | 'markdown' | 'excel' | 'csv';
  includeCharts?: boolean;
  includeRawData?: boolean;
  includeCorrections?: boolean;
  template?: string;
  title?: string;
  generatedAt?: Date;
}

export interface ReportData {
  batch: Batch;
  summary: StatsSummary;
  anomalies: Anomaly[];
  corrections: Correction[];
  trendData?: Array<{ date: string; count: number }>;
  employeeStats?: Array<{ employeeId: string; employeeName: string; count: number }>;
  departmentStats?: Array<{ department: string; count: number }>;
  ruleVersion?: RuleVersion;
}

export type FileType = 'csv' | 'excel' | 'unknown';

export interface ImportPreview {
  headers: string[];
  sampleData: any[];
  rowCount: number;
  fileType: FileType;
  fileName: string;
}
