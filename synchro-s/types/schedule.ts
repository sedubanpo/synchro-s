export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type AvailableTimeSlotsByDay = Partial<Record<Weekday, string[]>>;
export type InstructorWeekdayNotes = Partial<Record<Weekday, string>>;
export type InstructorAvailabilityPlannedClass = {
  slot: string;
  classTypeCode: string;
  classTypeLabel: string;
  badgeText: string;
  studentIds: string[];
  studentNames: string[];
};
export type InstructorAvailabilityDateOverride = {
  status: "available" | "temporary" | "unavailable";
  slots: string[];
  note?: string;
  plannedClasses?: Record<string, InstructorAvailabilityPlannedClass>;
};
export type InstructorAvailabilityDateOverrides = Record<string, InstructorAvailabilityDateOverride>;

export type StudentAvailabilitySlot = {
  status: "available" | "unavailable";
  note?: string;
  /** Legacy field kept for previously saved unavailable slots. */
  reason?: string;
};
export type StudentAvailabilityByDay = Partial<Record<Weekday, Partial<Record<string, StudentAvailabilitySlot>>>>;
export type StudentAvailabilityDateOverride = {
  status: "temporary" | "unavailable";
  slots: string[];
  note?: string;
};
export type StudentAvailabilityDateOverrides = Record<string, StudentAvailabilityDateOverride>;

export type RoleView = "instructor" | "student";
export type ScheduleMode = "recurring" | "one_off";
export type ScheduleStatus = "planned" | "confirmed" | "completed" | "cancelled";
export type OverrideAction = "cancel" | "reschedule" | "status_only";

export type ScheduleFormInput = {
  instructorId: string;
  sourceInstructorName?: string;
  sourceRawText?: string;
  studentIds: string[];
  subjectCode: string;
  classTypeCode: string;
  note: string;
  scheduleMode: ScheduleMode;
  weekday?: Weekday;
  classDate?: string;
  activeFrom?: string;
  startTime: string;
  endTime: string;
  scheduleTagId?: string;
};

export type ConflictExistingSchedule = {
  studentNames?: string[];
  classTypeCode?: string;
  classTypeLabel?: string;
  weekday?: Weekday;
  startTime?: string;
  endTime?: string;
  source?: "student_timetable" | "prospect_timetable";
};

export type ConflictResult = {
  hasConflict: boolean;
  conflicts: { classId: string; reason: string; existingSchedule?: ConflictExistingSchedule }[];
};

export type ConflictLogEntry = {
  id: string;
  createdAt: string;
  weekStart?: string | null;
  targetType?: "학생" | "강사" | null;
  targetName?: string | null;
  studentName: string;
  instructorName?: string | null;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  reason: string;
  details?: string | null;
  source: string;
  rawText?: string | null;
};

export type ConflictLogCreateInput = {
  weekStart?: string;
  targetType?: "학생" | "강사";
  targetName?: string;
  studentName: string;
  instructorName?: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  reason: string;
  details?: string;
  source: string;
  rawText?: string;
};

export type ScheduleEvent = {
  id: string;
  scheduleMode: ScheduleMode;
  instructorId: string;
  instructorName: string;
  studentIds: string[];
  studentNames: string[];
  subjectCode: string;
  subjectName: string;
  classTypeCode: string;
  classTypeLabel: string;
  badgeText: string;
  weekday: Weekday;
  classDate: string;
  startTime: string;
  endTime: string;
  progressStatus: ScheduleStatus;
  createdAt: string;
  note?: string;
};

export type SelectOption = {
  id: string;
  name: string;
  secondary?: string;
  school?: string;
  schoolIconUrl?: string;
  isActive?: boolean;
  daysOff?: Weekday[];
  availableTimeSlots?: string[];
  availableTimeSlotsByDay?: AvailableTimeSlotsByDay;
};

export type TimetableViewMode = "detailed" | "summary";

export type SubjectOption = {
  code: string;
  label: string;
};

export type ClassTypeOption = {
  code: string;
  label: string;
  badgeText: string;
  maxStudents: number;
  memo?: string;
};

export type ScheduleWeekResponse = {
  weekStart: string;
  weekEnd: string;
  events: ScheduleEvent[];
};

export type TimetableGroup = {
  id: string;
  name: string;
  roleView: RoleView;
  targetId: string;
  weekStart: string;
  expiresOn?: string | null;
  tagId?: string | null;
  classIds: string[];
  snapshotEvents?: ScheduleEvent[];
  isActive: boolean;
  createdAt: string;
};

export type CheckConflictRequest = ScheduleFormInput;
export type CreateScheduleRequest = ScheduleFormInput;

export type CreateScheduleResponse = {
  classId: string;
  conflict: ConflictResult;
};

export type UpdateScheduleStatusRequest = {
  status: ScheduleStatus;
  reason?: string;
};
