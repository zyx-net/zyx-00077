import type {
  ScheduleRecord,
  PunchRecord,
  LeaveRecord,
  MatchedRecord,
  MatchResult,
} from '../../types';
import { generateId, parseTime, diffMinutes, isSameDay, isNextDay, addDays, getDateString } from '../../utils/dateUtils';

export const findNearestPunch = (
  targetTime: Date,
  punches: PunchRecord[],
  windowMinutes: number = 120
): PunchRecord | null => {
  let nearest: PunchRecord | null = null;
  let minDiff = Infinity;
  
  punches.forEach(punch => {
    const diff = Math.abs(diffMinutes(targetTime, punch.punchTime));
    if (diff <= windowMinutes && diff < minDiff) {
      minDiff = diff;
      nearest = punch;
    }
  });
  
  return nearest;
};

export const findPunchesInRange = (
  startTime: Date,
  endTime: Date,
  punches: PunchRecord[]
): PunchRecord[] => {
  return punches.filter(punch => {
    const punchTime = punch.punchTime;
    return punchTime >= startTime && punchTime <= endTime;
  }).sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
};

export const handleCrossDayShift = (
  schedule: ScheduleRecord,
  punches: PunchRecord[]
): PunchRecord[] => {
  const scheduleDate = schedule.scheduleDate;
  const nextDate = addDays(scheduleDate, 1);
  const nextDateStr = getDateString(nextDate);
  
  return punches.filter(punch => {
    const punchDateStr = getDateString(punch.punchTime);
    return punchDateStr === scheduleDate || punchDateStr === nextDateStr;
  });
};

export const removeDuplicatePunches = (
  punches: PunchRecord[],
  thresholdMinutes: number = 5
): { punches: PunchRecord[]; duplicates: PunchRecord[] } => {
  if (punches.length <= 1) {
    return { punches, duplicates: [] };
  }
  
  const sorted = [...punches].sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  const result: PunchRecord[] = [];
  const duplicates: PunchRecord[] = [];
  let lastPunch: PunchRecord | null = null;
  
  sorted.forEach(punch => {
    if (lastPunch) {
      const diff = Math.abs(diffMinutes(lastPunch.punchTime, punch.punchTime));
      if (diff <= thresholdMinutes && punch.employeeId === lastPunch.employeeId) {
        duplicates.push(punch);
        return;
      }
    }
    result.push(punch);
    lastPunch = punch;
  });
  
  return { punches: result, duplicates };
};

export const matchSchedulesAndPunches = (
  schedules: ScheduleRecord[],
  punches: PunchRecord[],
  leaves: LeaveRecord[] = [],
  options: {
    matchWindowMinutes: number;
    duplicateThresholdMinutes: number;
  } = {
    matchWindowMinutes: 120,
    duplicateThresholdMinutes: 5,
  }
): MatchResult => {
  const matched: MatchedRecord[] = [];
  const unmatchedSchedules: ScheduleRecord[] = [];
  const unmatchedPunches: PunchRecord[] = [];
  
  const employeeSchedules = new Map<string, ScheduleRecord[]>();
  const employeePunches = new Map<string, PunchRecord[]>();
  const employeeLeaves = new Map<string, LeaveRecord[]>();
  
  schedules.forEach(s => {
    if (!employeeSchedules.has(s.employeeId)) {
      employeeSchedules.set(s.employeeId, []);
    }
    employeeSchedules.get(s.employeeId)!.push(s);
  });
  
  punches.forEach(p => {
    if (!employeePunches.has(p.employeeId)) {
      employeePunches.set(p.employeeId, []);
    }
    employeePunches.get(p.employeeId)!.push(p);
  });
  
  leaves.forEach(l => {
    if (!employeeLeaves.has(l.employeeId)) {
      employeeLeaves.set(l.employeeId, []);
    }
    employeeLeaves.get(l.employeeId)!.push(l);
  });
  
  const usedPunchIds = new Set<string>();
  
  schedules.forEach(schedule => {
    const employeePunchList = employeePunches.get(schedule.employeeId) || [];
    const employeeLeaveList = employeeLeaves.get(schedule.employeeId) || [];
    
    let relevantPunches: PunchRecord[];
    
    if (schedule.shiftType === 'crossDay') {
      relevantPunches = handleCrossDayShift(schedule, employeePunchList);
    } else {
      relevantPunches = employeePunchList.filter(p => isSameDay(p.punchTime, schedule.scheduleDate));
    }
    
    relevantPunches = relevantPunches.filter(p => !usedPunchIds.has(p.id));
    
    const scheduleDate = schedule.scheduleDate;
    const startDateTime = parseTime(schedule.startTime, scheduleDate);
    const endDateTime = parseTime(schedule.endTime, scheduleDate);
    
    if (!startDateTime || !endDateTime) {
      unmatchedSchedules.push(schedule);
      return;
    }
    
    let actualEndDateTime = endDateTime;
    if (schedule.shiftType === 'crossDay') {
      actualEndDateTime = parseTime(schedule.endTime, getDateString(addDays(scheduleDate, 1)));
    }
    
    const { punches: deduplicatedPunches, duplicates } = removeDuplicatePunches(
      relevantPunches,
      options.duplicateThresholdMinutes
    );
    
    const matchedPunches: PunchRecord[] = [];
    
    if (deduplicatedPunches.length > 0) {
      const sortedPunches = [...deduplicatedPunches].sort((a, b) => 
        a.punchTime.getTime() - b.punchTime.getTime()
      );
      
      const inPunch = findNearestPunch(
        startDateTime,
        sortedPunches.filter(p => !usedPunchIds.has(p.id)),
        options.matchWindowMinutes
      );
      
      if (inPunch) {
        matchedPunches.push(inPunch);
        usedPunchIds.add(inPunch.id);
      }
      
      const outPunch = findNearestPunch(
        actualEndDateTime!,
        sortedPunches.filter(p => !usedPunchIds.has(p.id)),
        options.matchWindowMinutes
      );
      
      if (outPunch) {
        matchedPunches.push(outPunch);
        usedPunchIds.add(outPunch.id);
      }
      
      sortedPunches.forEach(p => {
        if (!usedPunchIds.has(p.id) && 
            p.punchTime >= startDateTime && 
            p.punchTime <= actualEndDateTime!) {
          matchedPunches.push(p);
          usedPunchIds.add(p.id);
        }
      });
    }
    
    if (duplicates.length > 0) {
      matchedPunches.push(...duplicates);
    }
    
    const leaveForDay = employeeLeaveList.find(l => l.leaveDate === scheduleDate);
    
    let workStartTime: Date | undefined;
    let workEndTime: Date | undefined;
    let durationMinutes: number | undefined;
    
    if (matchedPunches.length >= 2) {
      const sorted = [...matchedPunches].sort((a, b) => 
        a.punchTime.getTime() - b.punchTime.getTime()
      );
      workStartTime = sorted[0].punchTime;
      workEndTime = sorted[sorted.length - 1].punchTime;
      durationMinutes = diffMinutes(workStartTime, workEndTime);
    }
    
    const matchedRecord: MatchedRecord = {
      id: generateId(),
      schedule,
      punches: matchedPunches,
      leave: leaveForDay,
      date: scheduleDate,
      employeeId: schedule.employeeId,
      workStartTime,
      workEndTime,
      durationMinutes,
    };
    
    matched.push(matchedRecord);
  });
  
  punches.forEach(punch => {
    if (!usedPunchIds.has(punch.id)) {
      unmatchedPunches.push(punch);
    }
  });
  
  return {
    matched,
    unmatchedSchedules,
    unmatchedPunches,
    summary: {
      totalSchedules: schedules.length,
      totalPunches: punches.length,
      matchedCount: matched.length,
      unmatchedSchedulesCount: unmatchedSchedules.length,
      unmatchedPunchesCount: unmatchedPunches.length,
    },
  };
};

export const matchModule = {
  findNearestPunch,
  findPunchesInRange,
  handleCrossDayShift,
  removeDuplicatePunches,
  matchSchedulesAndPunches,
};

export default matchModule;
