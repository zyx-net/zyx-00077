import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import type {
  ImportResult,
  ImportError,
  FileType,
  ImportPreview,
  FieldMapping,
  ScheduleRecord,
  PunchRecord,
  LeaveRecord,
} from '../../types';
import { generateId, parseDateTime, parseTime, getDefaultTimezone, getDateString } from '../../utils/dateUtils';

export const detectFileType = (file: File): FileType => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return 'csv';
  if (['xlsx', 'xls', 'xlsm'].includes(extension || '')) return 'excel';
  return 'unknown';
};

export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
};

export const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

export const parseCSV = async (
  file: File,
  hasHeader: boolean = true
): Promise<{ headers: string[]; data: any[] }> => {
  const text = await readFileAsText(file);
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: hasHeader,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(`CSV解析错误: ${results.errors[0].message}`));
          return;
        }
        const data = results.data as any[];
        let headers: string[] = [];
        if (hasHeader && data.length > 0) {
          headers = Object.keys(data[0]);
        } else if (!hasHeader && data.length > 0) {
          headers = data[0].map((_: any, i: number) => `列${i + 1}`);
        }
        resolve({ headers, data });
      },
      error: (error) => reject(error),
    });
  });
};

export const parseExcel = async (
  file: File
): Promise<{ headers: string[]; data: any[]; sheetNames: string[] }> => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetNames = workbook.SheetNames;
  
  if (sheetNames.length === 0) {
    throw new Error('Excel文件中没有工作表');
  }
  
  const firstSheet = workbook.Sheets[sheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd hh:mm:ss'
  }) as any[][];
  
  if (jsonData.length === 0) {
    return { headers: [], data: [], sheetNames };
  }
  
  const headers = jsonData[0].map((h: any) => String(h || ''));
  const data = jsonData.slice(1).map(row => {
    const obj: Record<string, any> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index] : '';
    });
    return obj;
  });
  
  return { headers, data, sheetNames };
};

export const getImportPreview = async (file: File): Promise<ImportPreview> => {
  const fileType = detectFileType(file);
  let headers: string[] = [];
  let data: any[] = [];
  
  if (fileType === 'csv') {
    const result = await parseCSV(file);
    headers = result.headers;
    data = result.data.slice(0, 10);
  } else if (fileType === 'excel') {
    const result = await parseExcel(file);
    headers = result.headers;
    data = result.data.slice(0, 10);
  } else {
    throw new Error('不支持的文件类型，请上传CSV或Excel文件');
  }
  
  return {
    headers,
    sampleData: data,
    rowCount: data.length,
    fileType,
    fileName: file.name,
  };
};

export const validateRequiredFields = (
  data: any[],
  requiredFields: string[],
  mapping: Record<string, string>
): ImportError[] => {
  const errors: ImportError[] = [];
  
  data.forEach((row, index) => {
    requiredFields.forEach(field => {
      const mappedField = mapping[field] || field;
      const value = row[mappedField];
      
      if (value === undefined || value === null || value === '') {
        errors.push({
          row: index + 2,
          column: mappedField,
          message: `缺少必填字段: ${field}`,
          value: value,
          code: 'MISSING_REQUIRED',
        });
      }
    });
  });
  
  return errors;
};

export const autoDetectMapping = (
  headers: string[],
  type: 'schedule' | 'punch' | 'leave'
): Record<string, string> => {
  const mapping: Record<string, string> = {};
  
  const scheduleFields: Record<string, string[]> = {
    employeeId: ['员工编号', '工号', 'employeeId', 'id', '编号'],
    employeeName: ['员工姓名', '姓名', 'name', 'employeeName'],
    department: ['部门', 'department', 'dept'],
    scheduleDate: ['日期', '排班日期', 'date', 'scheduleDate'],
    startTime: ['上班时间', '开始时间', 'startTime', '上班'],
    endTime: ['下班时间', '结束时间', 'endTime', '下班'],
    shiftType: ['班次类型', '班次', 'shiftType', 'type'],
    breakStartTime: ['休息开始', 'breakStartTime'],
    breakEndTime: ['休息结束', 'breakEndTime'],
  };
  
  const punchFields: Record<string, string[]> = {
    employeeId: ['员工编号', '工号', 'employeeId', 'id', '编号'],
    employeeName: ['员工姓名', '姓名', 'name', 'employeeName'],
    punchTime: ['打卡时间', '时间', 'punchTime', 'datetime', 'time'],
    punchType: ['打卡类型', '类型', 'punchType', '方向'],
    deviceId: ['设备编号', 'deviceId', '设备'],
    location: ['地点', 'location', '位置'],
  };
  
  const leaveFields: Record<string, string[]> = {
    employeeId: ['员工编号', '工号', 'employeeId', 'id', '编号'],
    employeeName: ['员工姓名', '姓名', 'name', 'employeeName'],
    leaveDate: ['日期', '请假日期', 'date', 'leaveDate'],
    leaveType: ['请假类型', '类型', 'leaveType', 'type'],
    hours: ['时长', '小时', 'hours', '天数'],
    startTime: ['开始时间', 'startTime'],
    endTime: ['结束时间', 'endTime'],
    reason: ['原因', '备注', 'reason', '事由'],
  };
  
  const fieldMap = type === 'schedule' ? scheduleFields : type === 'punch' ? punchFields : leaveFields;
  
  Object.entries(fieldMap).forEach(([field, aliases]) => {
    for (const alias of aliases) {
      const found = headers.find(h => 
        h.toLowerCase().trim() === alias.toLowerCase().trim() ||
        h.includes(alias)
      );
      if (found) {
        mapping[field] = found;
        break;
      }
    }
  });
  
  return mapping;
};

export const transformScheduleData = (
  rawData: any[],
  mapping: Record<string, string>,
  batchId: string
): ImportResult<ScheduleRecord> => {
  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const data: ScheduleRecord[] = [];
  
  const requiredFields = ['employeeId', 'employeeName', 'scheduleDate', 'startTime', 'endTime'];
  const fieldErrors = validateRequiredFields(rawData, requiredFields, mapping);
  errors.push(...fieldErrors);
  
  if (errors.length > 0) {
    return {
      success: false,
      data: [],
      errors,
      warnings,
      totalRows: rawData.length,
      validRows: 0,
    };
  }
  
  rawData.forEach((row, index) => {
    try {
      const employeeId = String(row[mapping.employeeId] || '').trim();
      const employeeName = String(row[mapping.employeeName] || '').trim();
      const scheduleDate = String(row[mapping.scheduleDate] || '').trim();
      const startTime = String(row[mapping.startTime] || '').trim();
      const endTime = String(row[mapping.endTime] || '').trim();
      
      if (!employeeId || !employeeName || !scheduleDate || !startTime || !endTime) {
        errors.push({
          row: index + 2,
          column: '',
          message: '必填字段不能为空',
          value: '',
          code: 'MISSING_REQUIRED',
        });
        return;
      }
      
      const parsedDate = parseDateTime(scheduleDate);
      if (!parsedDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
        errors.push({
          row: index + 2,
          column: mapping.scheduleDate,
          message: `日期格式不正确: ${scheduleDate}`,
          value: scheduleDate,
          code: 'INVALID_FORMAT',
        });
        return;
      }
      
      const parsedStart = parseTime(startTime);
      const parsedEnd = parseTime(endTime);
      
      if (!parsedStart) {
        errors.push({
          row: index + 2,
          column: mapping.startTime,
          message: `时间格式不正确: ${startTime}`,
          value: startTime,
          code: 'INVALID_FORMAT',
        });
        return;
      }
      
      if (!parsedEnd) {
        errors.push({
          row: index + 2,
          column: mapping.endTime,
          message: `时间格式不正确: ${endTime}`,
          value: endTime,
          code: 'INVALID_FORMAT',
        });
        return;
      }
      
      let shiftType: ScheduleRecord['shiftType'] = 'normal';
      const startMinutes = parsedStart.getHours() * 60 + parsedStart.getMinutes();
      const endMinutes = parsedEnd.getHours() * 60 + parsedEnd.getMinutes();
      
      if (endMinutes < startMinutes) {
        shiftType = 'crossDay';
      } else if (startMinutes >= 1320 || startMinutes < 360) {
        shiftType = 'night';
      }
      
      if (mapping.shiftType) {
        const typeValue = String(row[mapping.shiftType] || '').toLowerCase();
        if (typeValue.includes('跨日') || typeValue.includes('cross')) {
          shiftType = 'crossDay';
        } else if (typeValue.includes('夜班') || typeValue.includes('night')) {
          shiftType = 'night';
        }
      }
      
      const record: ScheduleRecord = {
        id: generateId(),
        batchId,
        employeeId,
        employeeName,
        department: mapping.department ? String(row[mapping.department] || '') : undefined,
        scheduleDate: /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) ? scheduleDate : getDateString(parsedDate!),
        startTime: `${String(parsedStart.getHours()).padStart(2, '0')}:${String(parsedStart.getMinutes()).padStart(2, '0')}`,
        endTime: `${String(parsedEnd.getHours()).padStart(2, '0')}:${String(parsedEnd.getMinutes()).padStart(2, '0')}`,
        shiftType,
        breakStartTime: mapping.breakStartTime ? String(row[mapping.breakStartTime] || '') : undefined,
        breakEndTime: mapping.breakEndTime ? String(row[mapping.breakEndTime] || '') : undefined,
        rawData: { ...row },
      };
      
      data.push(record);
    } catch (e) {
      errors.push({
        row: index + 2,
        column: '',
        message: `数据解析错误: ${e instanceof Error ? e.message : '未知错误'}`,
        value: row,
        code: 'INVALID_VALUE',
      });
    }
  });
  
  return {
    success: errors.length === 0,
    data,
    errors,
    warnings,
    totalRows: rawData.length,
    validRows: data.length,
  };
};

export const transformPunchData = (
  rawData: any[],
  mapping: Record<string, string>,
  batchId: string,
  timezone: string = getDefaultTimezone()
): ImportResult<PunchRecord> => {
  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const data: PunchRecord[] = [];
  
  const requiredFields = ['employeeId', 'punchTime'];
  const fieldErrors = validateRequiredFields(rawData, requiredFields, mapping);
  errors.push(...fieldErrors);
  
  if (errors.length > 0) {
    return {
      success: false,
      data: [],
      errors,
      warnings,
      totalRows: rawData.length,
      validRows: 0,
    };
  }
  
  rawData.forEach((row, index) => {
    try {
      const employeeId = String(row[mapping.employeeId] || '').trim();
      const punchTimeStr = String(row[mapping.punchTime] || '').trim();
      
      if (!employeeId || !punchTimeStr) {
        errors.push({
          row: index + 2,
          column: '',
          message: '必填字段不能为空',
          value: '',
          code: 'MISSING_REQUIRED',
        });
        return;
      }
      
      const punchTime = parseDateTime(punchTimeStr, timezone);
      if (!punchTime) {
        errors.push({
          row: index + 2,
          column: mapping.punchTime,
          message: `日期时间格式不正确: ${punchTimeStr}`,
          value: punchTimeStr,
          code: 'INVALID_FORMAT',
        });
        return;
      }
      
      let punchType: PunchRecord['punchType'] = 'auto';
      if (mapping.punchType) {
        const typeValue = String(row[mapping.punchType] || '').toLowerCase();
        if (typeValue.includes('上班') || typeValue.includes('in') || typeValue.includes('签到') || typeValue.includes('入')) {
          punchType = 'in';
        } else if (typeValue.includes('下班') || typeValue.includes('out') || typeValue.includes('签退') || typeValue.includes('出')) {
          punchType = 'out';
        }
      }
      
      const record: PunchRecord = {
        id: generateId(),
        batchId,
        employeeId,
        employeeName: mapping.employeeName ? String(row[mapping.employeeName] || '') : undefined,
        punchTime,
        punchType,
        deviceId: mapping.deviceId ? String(row[mapping.deviceId] || '') : undefined,
        location: mapping.location ? String(row[mapping.location] || '') : undefined,
        timezone,
        originalTime: punchTimeStr,
        rawData: { ...row },
      };
      
      data.push(record);
    } catch (e) {
      errors.push({
        row: index + 2,
        column: '',
        message: `数据解析错误: ${e instanceof Error ? e.message : '未知错误'}`,
        value: row,
        code: 'INVALID_VALUE',
      });
    }
  });
  
  return {
    success: errors.length === 0,
    data,
    errors,
    warnings,
    totalRows: rawData.length,
    validRows: data.length,
  };
};

export const transformLeaveData = (
  rawData: any[],
  mapping: Record<string, string>,
  batchId: string
): ImportResult<LeaveRecord> => {
  const errors: ImportError[] = [];
  const warnings: string[] = [];
  const data: LeaveRecord[] = [];
  
  const requiredFields = ['employeeId', 'leaveDate', 'leaveType', 'hours'];
  const fieldErrors = validateRequiredFields(rawData, requiredFields, mapping);
  errors.push(...fieldErrors);
  
  if (errors.length > 0) {
    return {
      success: false,
      data: [],
      errors,
      warnings,
      totalRows: rawData.length,
      validRows: 0,
    };
  }
  
  rawData.forEach((row, index) => {
    try {
      const employeeId = String(row[mapping.employeeId] || '').trim();
      const leaveDate = String(row[mapping.leaveDate] || '').trim();
      const leaveTypeStr = String(row[mapping.leaveType] || '').trim();
      const hoursStr = String(row[mapping.hours] || '').trim();
      
      if (!employeeId || !leaveDate || !leaveTypeStr || !hoursStr) {
        errors.push({
          row: index + 2,
          column: '',
          message: '必填字段不能为空',
          value: '',
          code: 'MISSING_REQUIRED',
        });
        return;
      }
      
      const parsedDate = parseDateTime(leaveDate);
      if (!parsedDate && !/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
        errors.push({
          row: index + 2,
          column: mapping.leaveDate,
          message: `日期格式不正确: ${leaveDate}`,
          value: leaveDate,
          code: 'INVALID_FORMAT',
        });
        return;
      }
      
      const hours = parseFloat(hoursStr);
      if (isNaN(hours) || hours <= 0 || hours > 24) {
        errors.push({
          row: index + 2,
          column: mapping.hours,
          message: `时长必须是0-24之间的数字: ${hoursStr}`,
          value: hoursStr,
          code: 'INVALID_VALUE',
        });
        return;
      }
      
      let leaveType: LeaveRecord['leaveType'] = 'other';
      const typeLower = leaveTypeStr.toLowerCase();
      if (typeLower.includes('年假') || typeLower.includes('annual')) {
        leaveType = 'annual';
      } else if (typeLower.includes('病假') || typeLower.includes('sick')) {
        leaveType = 'sick';
      } else if (typeLower.includes('事假') || typeLower.includes('personal')) {
        leaveType = 'personal';
      } else if (typeLower.includes('调休') || typeLower.includes('overtime')) {
        leaveType = 'overtime';
      }
      
      const record: LeaveRecord = {
        id: generateId(),
        batchId,
        employeeId,
        employeeName: mapping.employeeName ? String(row[mapping.employeeName] || '') : undefined,
        leaveDate: /^\d{4}-\d{2}-\d{2}$/.test(leaveDate) ? leaveDate : getDateString(parsedDate!),
        leaveType,
        hours,
        startTime: mapping.startTime ? String(row[mapping.startTime] || '') : undefined,
        endTime: mapping.endTime ? String(row[mapping.endTime] || '') : undefined,
        reason: mapping.reason ? String(row[mapping.reason] || '') : undefined,
        rawData: { ...row },
      };
      
      data.push(record);
    } catch (e) {
      errors.push({
        row: index + 2,
        column: '',
        message: `数据解析错误: ${e instanceof Error ? e.message : '未知错误'}`,
        value: row,
        code: 'INVALID_VALUE',
      });
    }
  });
  
  return {
    success: errors.length === 0,
    data,
    errors,
    warnings,
    totalRows: rawData.length,
    validRows: data.length,
  };
};

export const importModule = {
  detectFileType,
  getImportPreview,
  parseCSV,
  parseExcel,
  autoDetectMapping,
  validateRequiredFields,
  transformScheduleData,
  transformPunchData,
  transformLeaveData,
};

export default importModule;
