import { v4 as uuidv4 } from 'uuid';

export const generateId = (): string => uuidv4();

export const formatDate = (date: Date | string, format: string = 'YYYY-MM-DD'): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
};

export const formatTime = (date: Date | string): string => {
  return formatDate(date, 'HH:mm:ss');
};

export const formatDateTime = (date: Date | string): string => {
  return formatDate(date, 'YYYY-MM-DD HH:mm:ss');
};

export const parseTime = (timeStr: string, dateStr?: string): Date | null => {
  try {
    if (!timeStr) return null;
    
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(:(\d{2}))?$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
      
      let date: Date;
      if (dateStr) {
        date = new Date(dateStr);
      } else {
        date = new Date();
      }
      
      date.setHours(hours, minutes, seconds, 0);
      return date;
    }
    
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    return null;
  } catch {
    return null;
  }
};

export const parseDateTime = (dateTimeStr: string, timezone: string = 'Asia/Shanghai'): Date | null => {
  try {
    if (!dateTimeStr) return null;
    
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateTimeStr) ||
        /^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(dateTimeStr) ||
        /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(dateTimeStr)) {
      const normalized = dateTimeStr.replace(/\//g, '-').replace(' ', 'T');
      const date = new Date(normalized);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    const parsed = new Date(dateTimeStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    const formats = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(:(\d{2}))?$/,
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(:(\d{2}))?$/,
      /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(:(\d{2}))?$/,
    ];
    
    for (const regex of formats) {
      const match = dateTimeStr.match(regex);
      if (match) {
        let year, month, day;
        if (regex.source.startsWith('^(\\d{4})')) {
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          year = parseInt(match[3], 10);
          month = parseInt(match[1], 10) - 1;
          day = parseInt(match[2], 10);
        }
        const hours = parseInt(match[4], 10);
        const minutes = parseInt(match[5], 10);
        const seconds = match[7] ? parseInt(match[7], 10) : 0;
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
};

export const getDateString = (date: Date | string): string => {
  return formatDate(date, 'YYYY-MM-DD');
};

export const addDays = (date: Date | string, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const addMinutes = (date: Date | string, minutes: number): Date => {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
};

export const diffMinutes = (start: Date | string, end: Date | string): number => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
};

export const diffHours = (start: Date | string, end: Date | string): number => {
  return diffMinutes(start, end) / 60;
};

export const isSameDay = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
};

export const isNextDay = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const nextDay = addDays(d1, 1);
  return isSameDay(nextDay, d2);
};

export const getTimezoneOffset = (timezone: string): number => {
  const timezoneMap: Record<string, number> = {
    'Asia/Shanghai': 480,
    'UTC': 0,
    'America/New_York': -300,
    'America/Los_Angeles': -480,
    'Europe/London': 0,
    'Asia/Tokyo': 540,
    'Asia/Singapore': 480,
    'Australia/Sydney': 600,
  };
  return timezoneMap[timezone] ?? 480;
};

export const convertTimezone = (date: Date | string, fromTimezone: string, toTimezone: string): Date => {
  const d = new Date(date);
  const fromOffset = getTimezoneOffset(fromTimezone);
  const toOffset = getTimezoneOffset(toTimezone);
  const diffMinutes = toOffset - fromOffset;
  return addMinutes(d, diffMinutes);
};

export const isValidTimezone = (timezone: string): boolean => {
  const validTimezones = [
    'Asia/Shanghai', 'UTC', 'America/New_York', 'America/Los_Angeles',
    'Europe/London', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'
  ];
  return validTimezones.includes(timezone);
};

export const getDefaultTimezone = (): string => {
  return 'Asia/Shanghai';
};

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? '-' : '';
  
  if (hours > 0) {
    return `${sign}${hours}小时${mins}分钟`;
  }
  return `${sign}${mins}分钟`;
};

export const getStartOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getEndOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const getDayOfWeek = (date: Date | string): number => {
  return new Date(date).getDay();
};

export const isWeekend = (date: Date | string): boolean => {
  const day = getDayOfWeek(date);
  return day === 0 || day === 6;
};

export const getDateRange = (startDate: Date | string, endDate: Date | string): string[] => {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  while (start <= end) {
    dates.push(getDateString(start));
    start.setDate(start.getDate() + 1);
  }
  
  return dates;
};
