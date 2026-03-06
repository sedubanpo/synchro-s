// S-LMS (에스-엘엠에스) Headless REST API
// 배포 전 준비:
// 1) SLMS_CONFIG.SPREADSHEET_URL 또는 SPREADSHEET_ID에 실제 스프레드시트 값을 넣습니다.
// 2) 이 스크립트를 웹 앱으로 배포하고 실행 권한은 "나", 접근 권한은 "모든 사용자"로 설정합니다.
// 3) 브라우저 프론트엔드는 GET 쿼리스트링으로 호출합니다. GAS의 302 리다이렉트에서도 action과 파라미터가 유지됩니다.
// 4) doPost(e)는 보조 경로로 남겨두고, 실제 웹 프론트 호출은 doGet(e)를 사용합니다.

var SLMS_CONFIG = {
  APP_NAME: 'S-LMS (에스-엘엠에스)',
  LOGO_URL: 'https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png',
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/AKfycbytTEpagqxe_BShl5LYON51FWTbb1vp9UeqY28Jf-5FviS7cbVbveYRTiKjartU2Ob9/edit',
  SPREADSHEET_ID: '',
  SESSION_TTL_SECONDS: 60 * 60 * 6,
  SHEETS: {
    TEACHERS: 'Teachers',
    STUDENTS: 'student',
    PERMISSIONS: 'Permissions',
    MATERIALS: '기출문제 및 학습 자료',
    STUDENT_LOGS: 'StudentLogs',
    EVENTS: 'event'
  }
};

var SLMS_PERMISSION_HEADERS = [
  '학생ID',
  '학생명',
  '강사ID',
  '강사명',
  '권한',
  '수정일시',
  '수정자ID'
];

var SLMS_MATERIAL_HEADERS = [
  '학교',
  '학년',
  '대상 년도',
  '과목',
  '링크',
  '등록자',
  '등록일시'
];

var SLMS_STUDENT_LOG_HEADERS = [
  '학생ID',
  '학생명',
  '내용',
  '태그',
  '작성자ID',
  '작성자명',
  '작성자권한',
  '작성일시'
];

var SLMS_EVENT_HEADERS = [
  '날짜',
  '대상',
  '이벤트명',
  '비고',
  '제출자'
];

var SLMS_STUDENT_SHEET_HEADERS = {
  NAME: '이름 필드',
  SCHOOL: '원',
  GRADE: '학년 필드',
  STATUS: '등록 상태'
};

var SLMS_ADMIN_NAME_OVERRIDES = [
  '에스에듀',
  '안준성',
  '안종성',
  '홍성우',
  '김용찬'
];

function doGet(e) {
  try {
    var request = getRequestDataFromQuery_(e);
    var action = normalizeText_(request.action);

    if (!action) {
      return jsonResponse_({
        ok: true,
        message: 'S-LMS API GET Request Successful.'
      });
    }

    return routeApiRequest_(request);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      errorCode: getErrorCode_(error),
      message: getErrorMessage_(error)
    });
  }
}

function doPost(e) {
  try {
    var request = parsePostPayload_(e);
    return routeApiRequest_(request);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      errorCode: getErrorCode_(error),
      message: getErrorMessage_(error)
    });
  }
}

function routeApiRequest_(request) {
  var action = normalizeText_(request.action);
  if (!action) {
    throw createApiError_('INVALID_REQUEST', 'Invalid Request payload');
  }

  assertSpreadsheetConfigured_();
  ensureSupportSheets_();

  if (action === 'login') {
    return jsonResponse_(loginAction_(request));
  }
  if (action === 'getStudents') {
    return jsonResponse_(getStudentsAction_(request));
  }
  if (action === 'getMaterials') {
    return jsonResponse_(getMaterialsAction_(request));
  }
  if (action === 'getEvents') {
    return jsonResponse_(getEventsAction_(request));
  }
  if (action === 'addMaterial') {
    return jsonResponse_(addMaterialAction_(request));
  }
  if (action === 'addEvent') {
    return jsonResponse_(addEventAction_(request));
  }
  if (action === 'savePermissions') {
    return jsonResponse_(savePermissionsAction_(request));
  }
  if (action === 'addStudentLog') {
    return jsonResponse_(addStudentLogAction_(request));
  }
  if (action === 'deleteStudentLog') {
    return jsonResponse_(deleteStudentLogAction_(request));
  }

  return jsonResponse_({
    ok: false,
    errorCode: 'UNKNOWN_ACTION',
    message: '지원하지 않는 action입니다.'
  });
}

function parsePostPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw createApiError_('INVALID_REQUEST', 'Invalid Request payload');
  }

  try {
    var payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload must be an object');
    }
    return payload;
  } catch (error) {
    throw createApiError_('INVALID_REQUEST', 'Invalid Request payload');
  }
}

function getRequestDataFromQuery_(e) {
  var request = {};
  if (!e || !e.parameter) {
    return request;
  }

  for (var key in e.parameter) {
    if (e.parameter.hasOwnProperty(key)) {
      request[key] = e.parameter[key];
    }
  }

  if (request.instructorIds) {
    request.instructorIds = safeDecodeURIComponent_(request.instructorIds);
  }
  return request;
}

function safeDecodeURIComponent_(value) {
  try {
    return decodeURIComponent(String(value));
  } catch (error) {
    return String(value);
  }
}

function loginAction_(request) {
  var userId = normalizeText_(request.userId);
  var password = normalizeText_(request.password);

  if (!userId || !password) {
    throw createApiError_('INVALID_LOGIN', '아이디와 비밀번호를 모두 입력해주세요.');
  }

  var teachers = getTeachers_();
  var matchedUser = null;
  for (var i = 0; i < teachers.length; i += 1) {
    if (matchesLoginCredential_(teachers[i].userId, userId)) {
      matchedUser = teachers[i];
      break;
    }
  }

  if (!matchedUser) {
    throw createApiError_('INVALID_LOGIN', '등록된 강사 계정을 찾을 수 없습니다.');
  }

  var expectedPassword = normalizeText_(matchedUser.password) || normalizeText_(matchedUser.userId);
  if (!matchesLoginCredential_(expectedPassword, password)) {
    throw createApiError_('INVALID_LOGIN', '비밀번호가 올바르지 않습니다.');
  }

  var token = createSession_(matchedUser);
  return {
    ok: true,
    token: token,
    user: sanitizeUser_(matchedUser),
    appName: SLMS_CONFIG.APP_NAME,
    logoUrl: SLMS_CONFIG.LOGO_URL,
    message: '로그인되었습니다.'
  };
}

function getStudentsAction_(request) {
  var session = requireSession_(request.token);
  var user = session.user;
  var teachers = getTeachers_();
  var instructors = teachers
    .filter(function(item) { return item.role === 'INSTRUCTOR'; })
    .map(function(item) { return sanitizeUser_(item); });

  var activeStudents = getActiveStudents_();
  var activeLookup = buildStudentLookup_(activeStudents);
  var allPermissions = getPermissionRows_().filter(function(item) {
    return activeLookup[item.studentId];
  });
  var studentLogs = getStudentLogRows_().filter(function(item) {
    if (!activeLookup[item.studentId]) {
      return false;
    }
    return canUserViewStudentLog_(user, item);
  });
  var permissionMap = buildPermissionLookup_(allPermissions);

  var visibleStudents = user.role === 'ADMIN'
    ? activeStudents
    : activeStudents.filter(function(student) {
        return (permissionMap[student.studentId] || []).indexOf(user.userId) !== -1;
      });
  var logsByStudent = buildStudentLogLookup_(studentLogs);
  var hydratedStudents = visibleStudents.map(function(student) {
    var cloned = cloneStudent_(student);
    cloned.logs = logsByStudent[student.studentId] || [];
    return cloned;
  });

  var visibleLookup = buildStudentLookup_(hydratedStudents);
  var exposedPermissions = user.role === 'ADMIN'
    ? allPermissions
    : allPermissions.filter(function(item) {
        return item.instructorId === user.userId && visibleLookup[item.studentId];
      });

  return {
    ok: true,
    user: sanitizeUser_(user),
    isAdmin: user.role === 'ADMIN',
    totalActiveStudentCount: activeStudents.length,
    visibleStudents: hydratedStudents,
    activeStudents: user.role === 'ADMIN' ? activeStudents : hydratedStudents,
    instructors: user.role === 'ADMIN' ? instructors : [],
    permissions: exposedPermissions,
    appName: SLMS_CONFIG.APP_NAME,
    logoUrl: SLMS_CONFIG.LOGO_URL
  };
}

function canUserViewStudentLog_(user, logItem) {
  if (!logItem) {
    return false;
  }
  if (user.role === 'ADMIN') {
    return true;
  }
  if (isPrivateCounselingLog_(logItem)) {
    return normalizeText_(logItem.createdById) === normalizeText_(user.userId);
  }
  return true;
}

function isPrivateCounselingLog_(logItem) {
  var tags = logItem.tags || [];
  return tags.indexOf('학부모상담') !== -1 || tags.indexOf('학생상담') !== -1;
}

function getMaterialsAction_(request) {
  requireSession_(request.token);

  return {
    ok: true,
    materials: getMaterialRows_()
  };
}

function getEventsAction_(request) {
  requireSession_(request.token);

  return {
    ok: true,
    events: getEventRows_()
  };
}

function addMaterialAction_(request) {
  var session = requireSession_(request.token);

  var school = normalizeText_(request.school);
  var grade = normalizeText_(request.grade);
  var year = normalizeText_(request.year);
  var subject = normalizeText_(request.subject);
  var link = normalizeText_(request.link);

  if (!school || !grade || !year || !subject || !link) {
    throw createApiError_('INVALID_INPUT', '학교, 학년, 대상 년도, 과목, 링크를 모두 입력해주세요.');
  }
  if (!/^https?:\/\//i.test(link)) {
    throw createApiError_('INVALID_INPUT', '링크는 http:// 또는 https:// 형식으로 입력해주세요.');
  }

  withWriteLock_(function() {
    normalizeMaterialSheetStructure_();
    appendRow_(SLMS_CONFIG.SHEETS.MATERIALS, [
      school,
      grade,
      year,
      subject,
      link,
      session.user.name,
      formatTimestamp_(new Date())
    ]);
  });

  return {
    ok: true,
    materials: getMaterialRows_(),
    message: '자료가 저장되었습니다.'
  };
}

function addEventAction_(request) {
  var session = requireSession_(request.token);

  var dateText = normalizeText_(request.date);
  var target = normalizeText_(request.target);
  var title = normalizeText_(request.title);
  var note = normalizeText_(request.note);

  if (!dateText || !target || !title) {
    throw createApiError_('INVALID_INPUT', '날짜, 대상, 이벤트명을 모두 입력해주세요.');
  }

  withWriteLock_(function() {
    appendRow_(SLMS_CONFIG.SHEETS.EVENTS, [
      normalizeEventDateText_(dateText),
      target,
      title,
      note,
      session.user.name
    ]);
  });

  return {
    ok: true,
    events: getEventRows_(),
    message: '주요일정이 저장되었습니다.'
  };
}

function savePermissionsAction_(request) {
  var session = requireAdminSession_(request.token);
  var studentId = normalizeText_(request.studentId);
  var instructorIds = parseStringList_(request.instructorIds);

  if (!studentId) {
    throw createApiError_('INVALID_INPUT', '권한을 저장할 학생을 선택해주세요.');
  }

  var activeStudents = getActiveStudents_();
  var student = null;
  for (var i = 0; i < activeStudents.length; i += 1) {
    if (activeStudents[i].studentId === studentId) {
      student = activeStudents[i];
      break;
    }
  }
  if (!student) {
    throw createApiError_('INVALID_INPUT', '활성 학생만 권한을 지정할 수 있습니다.');
  }

  var teachers = getTeachers_();
  var instructorMap = {};
  teachers.forEach(function(item) {
    if (item.role === 'INSTRUCTOR') {
      instructorMap[item.userId] = item;
    }
  });

  withWriteLock_(function() {
    var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.PERMISSIONS, SLMS_PERMISSION_HEADERS);
    var values = getSheetValues_(sheet);
    var header = values.length ? values[0] : SLMS_PERMISSION_HEADERS;
    var body = values.slice(1).filter(function(row) {
      return normalizeText_(row[0]) !== studentId;
    });
    var timestamp = formatTimestamp_(new Date());

    instructorIds.forEach(function(instructorId) {
      if (!instructorMap[instructorId]) {
        return;
      }
      body.push([
        student.studentId,
        student.studentName,
        instructorMap[instructorId].userId,
        instructorMap[instructorId].name,
        'ALLOW',
        timestamp,
        session.user.userId
      ]);
    });

    writeWholeSheet_(sheet, [header].concat(body));
  });

  var response = getStudentsAction_({ token: request.token });
  response.message = '학생 열람 권한이 저장되었습니다.';
  return response;
}

function addStudentLogAction_(request) {
  var session = requireSession_(request.token);
  var studentId = normalizeText_(request.studentId);
  var content = normalizeText_(request.content);
  var tags = parseStringList_(request.tags);

  if (!studentId) {
    throw createApiError_('INVALID_INPUT', '학생을 선택해주세요.');
  }
  if (!content) {
    throw createApiError_('INVALID_INPUT', '티칭로그 내용을 입력해주세요.');
  }

  var accessibleStudents = getStudentsAction_({ token: request.token }).visibleStudents || [];
  var targetStudent = null;
  for (var i = 0; i < accessibleStudents.length; i += 1) {
    if (accessibleStudents[i].studentId === studentId) {
      targetStudent = accessibleStudents[i];
      break;
    }
  }

  if (!targetStudent) {
    throw createApiError_('FORBIDDEN', '해당 학생에 대한 접근 권한이 없습니다.');
  }

  withWriteLock_(function() {
    appendRow_(SLMS_CONFIG.SHEETS.STUDENT_LOGS, [
      targetStudent.studentId,
      targetStudent.studentName,
      content,
      tags.join(', '),
      session.user.userId,
      session.user.name,
      session.user.role,
      formatTimestamp_(new Date())
    ]);
  });

  var response = getStudentsAction_({ token: request.token });
  response.message = '티칭로그가 저장되었습니다.';
  return response;
}

function deleteStudentLogAction_(request) {
  var session = requireSession_(request.token);
  var logRowNumber = parseInt(normalizeText_(request.logRowNumber), 10);

  if (!logRowNumber || logRowNumber < 2) {
    throw createApiError_('INVALID_INPUT', '삭제할 티칭로그를 찾을 수 없습니다.');
  }

  var logRows = getStudentLogRows_();
  var targetLog = null;
  for (var i = 0; i < logRows.length; i += 1) {
    if (logRows[i].rowNumber === logRowNumber) {
      targetLog = logRows[i];
      break;
    }
  }

  if (!targetLog) {
    throw createApiError_('INVALID_INPUT', '이미 삭제되었거나 존재하지 않는 티칭로그입니다.');
  }

  var accessibleStudents = getStudentsAction_({ token: request.token }).visibleStudents || [];
  var canAccess = accessibleStudents.some(function(student) {
    return student.studentId === targetLog.studentId;
  });
  if (!canAccess) {
    throw createApiError_('FORBIDDEN', '해당 티칭로그에 대한 접근 권한이 없습니다.');
  }

  if (session.user.role !== 'ADMIN' && session.user.userId !== targetLog.createdById) {
    throw createApiError_('FORBIDDEN', '본인이 작성한 티칭로그만 삭제할 수 있습니다.');
  }

  withWriteLock_(function() {
    var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.STUDENT_LOGS, SLMS_STUDENT_LOG_HEADERS);
    sheet.deleteRow(logRowNumber);
  });

  var response = getStudentsAction_({ token: request.token });
  response.message = '티칭로그가 삭제되었습니다.';
  return response;
}

function getTeachers_() {
  var sheet = getRequiredSheet_(SLMS_CONFIG.SHEETS.TEACHERS);
  var values = getSheetValues_(sheet);
  if (values.length <= 1) {
    return [];
  }

  var teachers = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    var userId = normalizeText_(row[0]);
    var password = normalizeText_(row[6]);
    if (!userId) {
      continue;
    }

    teachers.push({
      userId: userId,
      password: password,
      name: normalizeText_(row[1]) || normalizeText_(row[2]) || userId,
      role: resolveTeacherRole_(row[7], row[1], row[2], row[0])
    });
  }

  return teachers;
}

function getActiveStudents_() {
  var sheet = getRequiredSheet_(SLMS_CONFIG.SHEETS.STUDENTS);
  var values = getSheetValues_(sheet);
  if (!values.length) {
    return [];
  }

  var headers = values[0];
  var indexes = {
    name: findExactHeaderIndex_(headers, SLMS_STUDENT_SHEET_HEADERS.NAME, 0),
    school: findExactHeaderIndex_(headers, SLMS_STUDENT_SHEET_HEADERS.SCHOOL, 1),
    grade: findExactHeaderIndex_(headers, SLMS_STUDENT_SHEET_HEADERS.GRADE, 2),
    status: findExactHeaderIndex_(headers, SLMS_STUDENT_SHEET_HEADERS.STATUS, 3),
    phone: findHeaderIndex_(headers, ['연락처', '전화번호', '학부모연락처', '학부모 연락처']),
    note: findHeaderIndex_(headers, ['비고', '메모', 'note'])
  };

  var students = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    if (!isTruthyCell_(row[indexes.status])) {
      continue;
    }

    var rowNumber = i + 1;
    var studentName = sanitizeStudentName_(readByIndex_(row, indexes.name)) || '학생-' + rowNumber;
    var studentId = 'ROW-' + rowNumber;

    students.push({
      studentId: studentId,
      studentName: studentName,
      school: sanitizeStudentText_(readByIndex_(row, indexes.school)),
      grade: sanitizeStudentText_(readByIndex_(row, indexes.grade)),
      subject: '',
      phone: readByIndex_(row, indexes.phone),
      note: readByIndex_(row, indexes.note),
      rowNumber: rowNumber,
      details: buildStudentDetails_(headers, row)
    });
  }

  return students;
}

function getPermissionRows_() {
  var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.PERMISSIONS, SLMS_PERMISSION_HEADERS);
  var values = getSheetValues_(sheet);
  if (values.length <= 1) {
    return [];
  }

  var permissions = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    var studentId = normalizeText_(row[0]);
    var instructorId = normalizeText_(row[2]);
    if (!studentId || !instructorId) {
      continue;
    }

    permissions.push({
      studentId: studentId,
      studentName: normalizeText_(row[1]),
      instructorId: instructorId,
      instructorName: normalizeText_(row[3]),
      permission: normalizeText_(row[4]) || 'ALLOW',
      updatedAt: normalizeText_(row[5]),
      updatedBy: normalizeText_(row[6])
    });
  }

  return permissions;
}

function getMaterialRows_() {
  var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.MATERIALS, SLMS_MATERIAL_HEADERS);
  var values = getSheetValues_(sheet);
  if (values.length <= 1) {
    return [];
  }

  var headers = values[0] || [];
  var indexes = {
    school: findExactHeaderIndex_(headers, '학교', 0),
    grade: findExactHeaderIndex_(headers, '학년', -1),
    year: findExactHeaderIndex_(headers, '대상 년도', findExactHeaderIndex_(headers, '대상년도', 1)),
    subject: findExactHeaderIndex_(headers, '과목', 2),
    link: findExactHeaderIndex_(headers, '링크', 3),
    createdBy: findExactHeaderIndex_(headers, '등록자', 4),
    createdAt: findExactHeaderIndex_(headers, '등록일시', 5)
  };

  var materials = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    if (!normalizeText_(readByIndex_(row, indexes.school))) {
      continue;
    }

    materials.push({
      school: readByIndex_(row, indexes.school),
      grade: readByIndex_(row, indexes.grade),
      year: readByIndex_(row, indexes.year),
      subject: readByIndex_(row, indexes.subject),
      link: readByIndex_(row, indexes.link),
      createdBy: readByIndex_(row, indexes.createdBy),
      createdAt: readByIndex_(row, indexes.createdAt)
    });
  }

  materials.reverse();
  return materials;
}

function normalizeMaterialSheetStructure_() {
  var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.MATERIALS, SLMS_MATERIAL_HEADERS);
  var values = getSheetValues_(sheet);
  if (!values.length) {
    return;
  }

  var headers = values[0] || [];
  if (findExactHeaderIndex_(headers, '학년', -1) !== -1 && headers.length >= SLMS_MATERIAL_HEADERS.length) {
    return;
  }

  var oldRows = values.slice(1);
  var migrated = oldRows.map(function(row) {
    var current = row || [];
    return [
      normalizeText_(current[0]),
      '',
      normalizeText_(current[1]),
      normalizeText_(current[2]),
      normalizeText_(current[3]),
      normalizeText_(current[4]),
      normalizeText_(current[5])
    ];
  });

  writeWholeSheet_(sheet, [SLMS_MATERIAL_HEADERS].concat(migrated));
}

function getStudentLogRows_() {
  var sheet = ensureSheetExists_(SLMS_CONFIG.SHEETS.STUDENT_LOGS, SLMS_STUDENT_LOG_HEADERS);
  var values = getSheetValues_(sheet);
  if (values.length <= 1) {
    return [];
  }

  var logs = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    var studentId = normalizeText_(row[0]);
    var content = normalizeText_(row[2]);
    if (!studentId || !content) {
      continue;
    }

    logs.push({
      rowNumber: i + 1,
      studentId: studentId,
      studentName: sanitizeStudentName_(row[1]),
      content: content,
      tags: parseTagText_(row[3]),
      createdById: normalizeText_(row[4]),
      createdByName: normalizeText_(row[5]),
      createdByRole: normalizeRole_(row[6]),
      createdAt: normalizeText_(row[7])
    });
  }

  logs.reverse();
  return logs;
}

function getEventRows_() {
  var sheet = getRequiredSheet_(SLMS_CONFIG.SHEETS.EVENTS);
  var values = getSheetValues_(sheet);
  if (values.length <= 1) {
    return [];
  }

  var headers = values[0] || [];
  var indexes = {
    date: findExactHeaderIndex_(headers, SLMS_EVENT_HEADERS[0], 0),
    target: findExactHeaderIndex_(headers, SLMS_EVENT_HEADERS[1], 1),
    title: findExactHeaderIndex_(headers, SLMS_EVENT_HEADERS[2], 2),
    note: findExactHeaderIndex_(headers, SLMS_EVENT_HEADERS[3], 3),
    submitter: findExactHeaderIndex_(headers, SLMS_EVENT_HEADERS[4], 4)
  };

  var events = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i] || [];
    var rawDate = normalizeText_(readByIndex_(row, indexes.date));
    var title = normalizeText_(readByIndex_(row, indexes.title));
    if (!rawDate || !title) {
      continue;
    }

    var parsedDate = parseEventDate_(rawDate);
    events.push({
      rowNumber: i + 1,
      date: rawDate,
      isoDate: parsedDate ? formatDateOnly_(parsedDate) : '',
      target: normalizeText_(readByIndex_(row, indexes.target)),
      title: title,
      note: normalizeText_(readByIndex_(row, indexes.note)),
      submitter: normalizeText_(readByIndex_(row, indexes.submitter))
    });
  }

  events.sort(function(a, b) {
    return String(a.isoDate || a.date).localeCompare(String(b.isoDate || b.date));
  });

  return events;
}

function ensureSupportSheets_() {
  ensureSheetExists_(SLMS_CONFIG.SHEETS.PERMISSIONS, SLMS_PERMISSION_HEADERS);
  ensureSheetExists_(SLMS_CONFIG.SHEETS.MATERIALS, SLMS_MATERIAL_HEADERS);
  ensureSheetExists_(SLMS_CONFIG.SHEETS.STUDENT_LOGS, SLMS_STUDENT_LOG_HEADERS);
  ensureSheetExists_(SLMS_CONFIG.SHEETS.EVENTS, SLMS_EVENT_HEADERS);
}

function getSpreadsheet_() {
  var activeSpreadsheet = null;
  try {
    activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  } catch (error) {}

  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  return SpreadsheetApp.openById(getSpreadsheetId_());
}

function getRequiredSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw createApiError_('MISSING_SHEET', "'" + sheetName + "' 시트를 찾을 수 없습니다.");
  }
  return sheet;
}

function ensureSheetExists_(sheetName, headers) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (!headers || !headers.length) {
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  var firstRow = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  var hasHeader = firstRow.some(function(value) {
    return normalizeText_(value);
  });
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function getSheetValues_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    return [];
  }
  return sheet.getDataRange().getValues();
}

function appendRow_(sheetName, row) {
  var sheet = ensureSheetExists_(sheetName);
  sheet.appendRow(row);
}

function writeWholeSheet_(sheet, values) {
  var matrix = values && values.length ? values : [[]];
  var columnCount = matrix.reduce(function(maxValue, row) {
    return Math.max(maxValue, row.length);
  }, 1);

  var normalizedMatrix = matrix.map(function(row) {
    var current = row.slice();
    while (current.length < columnCount) {
      current.push('');
    }
    return current;
  });

  sheet.clearContents();
  sheet.getRange(1, 1, normalizedMatrix.length, columnCount).setValues(normalizedMatrix);
}

function buildPermissionLookup_(permissions) {
  var map = {};
  permissions.forEach(function(item) {
    if ((item.permission || '').toUpperCase() !== 'ALLOW') {
      return;
    }
    if (!map[item.studentId]) {
      map[item.studentId] = [];
    }
    if (map[item.studentId].indexOf(item.instructorId) === -1) {
      map[item.studentId].push(item.instructorId);
    }
  });
  return map;
}

function buildStudentLookup_(students) {
  var map = {};
  students.forEach(function(student) {
    map[student.studentId] = true;
  });
  return map;
}

function buildStudentLogLookup_(logs) {
  var map = {};
  logs.forEach(function(log) {
    if (!map[log.studentId]) {
      map[log.studentId] = [];
    }
    map[log.studentId].push(log);
  });
  return map;
}

function cloneStudent_(student) {
  return {
    studentId: student.studentId,
    studentName: student.studentName,
    school: student.school,
    grade: student.grade,
    subject: student.subject,
    phone: student.phone,
    note: student.note,
    rowNumber: student.rowNumber,
    details: (student.details || []).slice()
  };
}

function buildStudentDetails_(headers, row) {
  var skippedHeaders = [
    '이름 필드',
    '원',
    '학년 필드',
    '등록 상태',
    '학생id',
    'studentid',
    'id',
    '학번',
    '학생명',
    '이름',
    '성명',
    '학교',
    '학년',
    '대상년도',
    '대상 년도',
    '과목',
    '등록상태',
    '등록 상태',
    '연락처',
    '전화번호',
    '학부모연락처',
    '학부모 연락처',
    '비고',
    '메모',
    'note'
  ];
  var details = [];

  for (var i = 0; i < headers.length; i += 1) {
    var header = normalizeText_(headers[i]);
    var value = normalizeText_(row[i]);
    if (!header || !value) {
      continue;
    }
    if (normalizeText_(header) === SLMS_STUDENT_SHEET_HEADERS.STATUS) {
      continue;
    }
    if (skippedHeaders.indexOf(header) !== -1 || skippedHeaders.indexOf(normalizeHeader_(header)) !== -1) {
      continue;
    }

    details.push({
      label: header,
      value: i === findExactHeaderIndex_(headers, SLMS_STUDENT_SHEET_HEADERS.NAME, 0)
        ? sanitizeStudentName_(value)
        : sanitizeStudentText_(value)
    });
  }

  return details.slice(0, 6);
}

function createSession_(user) {
  var token = Utilities.getUuid();
  var payload = {
    user: sanitizeUser_(user),
    createdAt: new Date().toISOString()
  };

  CacheService.getScriptCache().put(
    getSessionKey_(token),
    JSON.stringify(payload),
    SLMS_CONFIG.SESSION_TTL_SECONDS
  );

  return token;
}

function requireSession_(token) {
  var session = getSession_(token);
  if (!session) {
    throw createApiError_('SESSION_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해주세요.');
  }
  return session;
}

function requireAdminSession_(token) {
  var session = requireSession_(token);
  if (session.user.role !== 'ADMIN') {
    throw createApiError_('FORBIDDEN', '관리자만 접근할 수 있습니다.');
  }
  return session;
}

function getSession_(token) {
  var sessionToken = normalizeText_(token);
  if (!sessionToken) {
    return null;
  }

  var cached = CacheService.getScriptCache().get(getSessionKey_(sessionToken));
  if (!cached) {
    return null;
  }

  return JSON.parse(cached);
}

function getSessionKey_(token) {
  return 'SLMS_API_SESSION_' + token;
}

function sanitizeUser_(user) {
  return {
    userId: user.userId,
    name: user.name,
    role: user.role,
    roleLabel: user.role === 'ADMIN' ? '관리자' : '강사'
  };
}

function normalizeRole_(value) {
  var raw = normalizeText_(value).toUpperCase();
  if (raw === 'ADMIN' || raw === '관리자' || raw === '원장') {
    return 'ADMIN';
  }
  return 'INSTRUCTOR';
}

function matchesLoginCredential_(sourceValue, inputValue) {
  var source = normalizeText_(sourceValue);
  var input = normalizeText_(inputValue);
  if (!source || !input) {
    return false;
  }

  if (source === input) {
    return true;
  }

  var normalizedSourcePhone = normalizePhoneCredential_(source);
  var normalizedInputPhone = normalizePhoneCredential_(input);
  if (normalizedSourcePhone && normalizedInputPhone && normalizedSourcePhone === normalizedInputPhone) {
    return true;
  }

  return false;
}

function normalizePhoneCredential_(value) {
  var digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.length === 8) {
    return digits;
  }

  if (digits.length === 11 && digits.indexOf('010') === 0) {
    return digits.slice(3);
  }

  if (digits.length === 10 && digits.indexOf('10') === 0) {
    return digits.slice(2);
  }

  return '';
}

function resolveTeacherRole_(roleValue, nameValue, fallbackNameValue, userIdValue) {
  var normalizedRole = normalizeRole_(roleValue);
  if (normalizedRole === 'ADMIN') {
    return 'ADMIN';
  }

  var candidates = [
    normalizeText_(nameValue),
    normalizeText_(fallbackNameValue),
    normalizeText_(userIdValue)
  ];

  for (var i = 0; i < candidates.length; i += 1) {
    if (SLMS_ADMIN_NAME_OVERRIDES.indexOf(candidates[i]) !== -1) {
      return 'ADMIN';
    }
  }

  return 'INSTRUCTOR';
}

function normalizeEventDateText_(value) {
  var parsed = parseEventDate_(value);
  return parsed ? formatEventDateDisplay_(parsed) : normalizeText_(value);
}

function parseEventDate_(value) {
  var text = normalizeText_(value);
  if (!text) {
    return null;
  }

  var normalized = text
    .replace(/[년.\/-]/g, ' ')
    .replace(/월/g, ' ')
    .replace(/일/g, ' ');
  var parts = normalized.replace(/\s+/g, ' ').trim().split(' ');
  if (parts.length >= 3) {
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month - 1, day);
    }
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  return null;
}

function formatEventDateDisplay_(date) {
  return [
    date.getFullYear(),
    '. ',
    date.getMonth() + 1,
    '. ',
    date.getDate()
  ].join('');
}

function formatDateOnly_(date) {
  return [
    date.getFullYear(),
    '-',
    padNumber_(date.getMonth() + 1),
    '-',
    padNumber_(date.getDate())
  ].join('');
}

function padNumber_(value) {
  return String(value).length === 1 ? '0' + value : String(value);
}

function parseStringList_(value) {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  var list = value;
  if (!isArray_(list)) {
    var text = normalizeText_(list);
    if (!text) {
      return [];
    }

    if (text.charAt(0) === '[') {
      try {
        list = JSON.parse(text);
      } catch (ignore) {
        list = text.split(',');
      }
    } else {
      list = text.split(',');
    }
  }

  if (!isArray_(list)) {
    list = [list];
  }

  return uniqueList_(
    list
      .map(function(item) { return normalizeText_(item); })
      .filter(function(item) { return Boolean(item); })
  );
}

function parseTagText_(value) {
  return parseStringList_(String(value === null || value === undefined ? '' : value).replace(/,\s*/g, ','));
}

function isArray_(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function normalizeText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u00A0/g, ' ')
    .trim();
}

function normalizeHeader_(value) {
  return normalizeText_(value)
    .toLowerCase()
    .replace(/[\s_/-]/g, '');
}

function findExactHeaderIndex_(headers, headerName, fallbackIndex) {
  var target = normalizeText_(headerName);
  for (var i = 0; i < headers.length; i += 1) {
    if (normalizeText_(headers[i]) === target) {
      return i;
    }
  }
  return typeof fallbackIndex === 'number' ? fallbackIndex : -1;
}

function findHeaderIndex_(headers, candidates) {
  if (!headers || !headers.length) {
    return -1;
  }

  var normalizedCandidates = candidates.map(function(item) {
    return normalizeHeader_(item);
  });

  for (var i = 0; i < headers.length; i += 1) {
    var header = normalizeHeader_(headers[i]);
    for (var j = 0; j < normalizedCandidates.length; j += 1) {
      if (header === normalizedCandidates[j] || header.indexOf(normalizedCandidates[j]) !== -1) {
        return i;
      }
    }
  }

  return -1;
}

function readByIndex_(row, index) {
  if (index < 0) {
    return '';
  }
  return normalizeText_(row[index]);
}

function sanitizeStudentName_(value) {
  return normalizeText_(value).replace(/^\s*\/+/, '').trim();
}

function sanitizeStudentText_(value) {
  return normalizeText_(value).replace(/^\s+|\s+$/g, '');
}

function isTruthyCell_(value) {
  if (value === true) {
    return true;
  }

  var text = String(value === null || value === undefined ? '' : value).toUpperCase();
  return text === 'TRUE' || text === 'Y' || text === 'YES' || text === '1' || text === '예';
}

function uniqueList_(items) {
  return items.filter(function(item, index) {
    return items.indexOf(item) === index;
  });
}

function formatTimestamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function withWriteLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheetId_() {
  if (normalizeText_(SLMS_CONFIG.SPREADSHEET_ID)) {
    return validateSpreadsheetId_(normalizeText_(SLMS_CONFIG.SPREADSHEET_ID));
  }

  var matched = String(SLMS_CONFIG.SPREADSHEET_URL || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (matched && matched[1]) {
    return validateSpreadsheetId_(matched[1]);
  }

  throw createApiError_('INVALID_CONFIG', 'SLMS_CONFIG에 유효한 스프레드시트 ID 또는 URL을 입력해주세요.');
}

function assertSpreadsheetConfigured_() {
  getSpreadsheet_();
}

function validateSpreadsheetId_(value) {
  var id = normalizeText_(value);
  if (!id || id === 'PUT_YOUR_SPREADSHEET_ID_HERE') {
    throw createApiError_('INVALID_CONFIG', 'SLMS_CONFIG에 실제 스프레드시트 ID 또는 URL을 입력해주세요.');
  }
  return id;
}

function createApiError_(code, message) {
  var error = new Error(message);
  error.apiCode = code;
  return error;
}

function getErrorCode_(error) {
  return error && error.apiCode ? error.apiCode : 'SERVER_ERROR';
}

function getErrorMessage_(error) {
  if (!error) {
    return '서버 오류가 발생했습니다.';
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
