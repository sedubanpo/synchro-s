// [1] 구글 스프레드시트 ID
const TEACHER_SS_ID = '1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho'; 
const ATTENDANCE_SS_ID = '1LukDneQLlU_F4s12V33z7gyhfIpZa47JVawKPY8xCfY'; 
const PAYROLL_SS_ID = '1RelndJgXn0yMNSg41Pyy1yDV6zjehG2ljMuue5pod1E';
const SEDU_LOGO_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop offset=%220%25%22 stop-color=%2216a34a%22/%3E%3Cstop offset=%22100%25%22 stop-color=%220f766e%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x=%224%22 y=%224%22 width=%2256%22 height=%2256%22 rx=%2214%22 fill=%22url(%23g)%22/%3E%3Cpath d=%22M43 18h-9.3c-7.9 0-14.3 5.6-14.3 12.5 0 6 4.8 10.6 12.5 12.2l5.8 1.2c2.9.6 4.5 2.1 4.5 4.1 0 2.6-2.7 4.5-6.4 4.5H20.5v-6.6h14.6c1.9 0 3.2-.8 3.2-2.1 0-1-.8-1.8-2.3-2.1L30 40.4c-8.6-1.9-13.7-7-13.7-13.8C16.3 16.9 24 10.5 33.6 10.5H43V18z%22 fill=%22%23ffffff%22/%3E%3C/svg%3E';
const PAYROLL_CACHE_SCHEMA_VERSION = "v5";
const PAYROLL_TEACHER_SETTINGS_PROP = "PAYROLL_TEACHER_SETTINGS_V1";
const TUITION_FOLLOWUP_SHEET_NAME = "수강료_관리";
const TUITION_CONTACT_LOG_SHEET_NAME = "수강료_연락로그";

// [2] Firebase 설정
const FB_URL = "https://sedu-portal-default-rtdb.firebaseio.com/";
const FB_SECRET = "oMxZXZl73LPJ4cpGoo5pM1SHyhsmlqlXiBqyhOa3";

function doGet(e) {
  var view = e && e.parameter ? String(e.parameter.view || '').toLowerCase() : '';
  var templateName = view === 'legacy' ? 'index' : 'payroll_portal';
  var title = view === 'legacy' ? 'SEDU Teacher Portal' : 'SEDU Payroll Portal';

  return HtmlService.createTemplateFromFile(templateName).evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function verifyPayrollPortalPassword(inputPassword) {
  var text = String(inputPassword || '').trim();
  if (!text) return { success: false };
  var allow = {
    'qksvhtjch': true,
    '반포서초': true,
    'tjchqksvh': true,
    '서초반포': true
  };
  return { success: !!allow[text] };
}

function verifyPayrollPrivilegedPassword(inputPassword) {
  var text = String(inputPassword || "").trim();
  return { success: text === "에스학원12" || text === "dptmgkrdnjs12" };
}

function getPayrollSettings() {
  try {
    var settings = loadPayrollTeacherSettings_();
    return { success: true, settings: settings };
  } catch (e) {
    return { success: false, message: "설정 조회 오류: " + e.message };
  }
}

function savePayrollSettings(payload) {
  try {
    var req = payload || {};
    var monthName = String(req.monthName || "").trim();
    var updates = Array.isArray(req.updates) ? req.updates : [];
    var current = loadPayrollTeacherSettings_();

    updates.forEach(function(item) {
      var teacher = String((item && item.teacher) || "").trim();
      if (!teacher) return;
      var salaryMode = normalizePayrollSalaryMode_(item.salaryMode);
      var hourlyRate = Math.max(0, toPayrollNumber_(item.hourlyRate));
      var oneToOneSettlementMode = String((item && item.oneToOneSettlementMode) || "").toLowerCase() === "ratio" ? "ratio" : "hourly";
      var oneToOneRatioPercent = clampPayrollNumber_(toPayrollNumber_(item.oneToOneRatioPercent), 0, 100, 50);
      var bankName = String((item && item.bankName) || "").trim();
      var accountNumber = String((item && item.accountNumber) || "").trim();
      var accountHolder = String((item && item.accountHolder) || "").trim();
      var paid = !!(item && item.paid);

      if (!current[teacher]) current[teacher] = {};
      current[teacher].salaryMode = salaryMode;
      current[teacher].hourlyRate = hourlyRate;
      current[teacher].oneToOneSettlementMode = oneToOneSettlementMode;
      current[teacher].oneToOneRatioPercent = oneToOneRatioPercent;
      current[teacher].bankName = bankName;
      current[teacher].accountNumber = accountNumber;
      current[teacher].accountHolder = accountHolder;
      if (monthName) {
        if (!current[teacher].paidByMonth || typeof current[teacher].paidByMonth !== "object") {
          current[teacher].paidByMonth = {};
        }
        current[teacher].paidByMonth[monthName] = paid;
      }
      current[teacher].updatedAt = new Date().toISOString();
    });

    storePayrollTeacherSettings_(current);
    return { success: true, settings: current };
  } catch (e) {
    return { success: false, message: "설정 저장 오류: " + e.message };
  }
}

function loadPayrollTeacherSettings_() {
  var raw = String(PropertiesService.getScriptProperties().getProperty(PAYROLL_TEACHER_SETTINGS_PROP) || "").trim();
  if (!raw) return {};
  var parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

function storePayrollTeacherSettings_(settings) {
  var data = settings && typeof settings === "object" ? settings : {};
  PropertiesService.getScriptProperties().setProperty(PAYROLL_TEACHER_SETTINGS_PROP, JSON.stringify(data));
}

function getFirebaseConfigFromProps_() {
  var props = PropertiesService.getScriptProperties();
  var dbUrl = String(props.getProperty("FIREBASE_DB_URL") || "").trim().replace(/\/+$/, "");
  var projectId = String(props.getProperty("FIREBASE_PROJECT_ID") || "").trim();
  var b64 = String(props.getProperty("FIREBASE_SERVICE_ACCOUNT_JSON_B64") || "").trim();
  if (!dbUrl) throw new Error("스크립트 속성 FIREBASE_DB_URL이 비어 있습니다.");
  if (!b64) throw new Error("스크립트 속성 FIREBASE_SERVICE_ACCOUNT_JSON_B64가 비어 있습니다.");

  var saJsonText = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
  var serviceAccount = JSON.parse(saJsonText);
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("서비스 계정 JSON 필수 필드(client_email/private_key)가 없습니다.");
  }
  return {
    dbUrl: dbUrl,
    projectId: projectId,
    serviceAccount: serviceAccount
  };
}

function getFirebaseAccessTokenFromServiceAccount_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("FIREBASE_SA_ACCESS_TOKEN_V1");
  if (cached) return cached;

  var cfg = getFirebaseConfigFromProps_();
  var sa = cfg.serviceAccount;
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: "RS256", typ: "JWT" };
  var claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  var encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, "");
  var encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=+$/, "");
  var unsignedJwt = encodedHeader + "." + encodedClaim;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsignedJwt, sa.private_key)
  ).replace(/=+$/, "");
  var jwt = unsignedJwt + "." + signature;

  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 토큰 발급 실패(" + code + "): " + text);
  }
  var tokenResult = JSON.parse(text);
  var accessToken = tokenResult.access_token;
  if (!accessToken) throw new Error("Firebase 토큰 응답에 access_token이 없습니다.");

  cache.put("FIREBASE_SA_ACCESS_TOKEN_V1", accessToken, 3300);
  return accessToken;
}

function firebaseRequestWithServiceAccount_(method, path, payload) {
  var cfg = getFirebaseConfigFromProps_();
  var token = getFirebaseAccessTokenFromServiceAccount_();
  var cleanPath = String(path || "").replace(/^\/+/, "");
  var url = cfg.dbUrl + "/" + cleanPath + ".json";
  var options = {
    method: String(method || "get").toLowerCase(),
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  };

  if (typeof payload !== "undefined") {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Firebase 요청 실패(" + code + ") " + cleanPath + ": " + text);
  }
  return text ? JSON.parse(text) : null;
}

function firebaseSmokeTest() {
  var now = new Date();
  var payload = {
    ok: true,
    timestamp: now.toISOString(),
    scriptTimeZone: Session.getScriptTimeZone(),
    projectId: String(PropertiesService.getScriptProperties().getProperty("FIREBASE_PROJECT_ID") || "")
  };
  firebaseRequestWithServiceAccount_("put", "payroll/_smoke", payload);
  return firebaseRequestWithServiceAccount_("get", "payroll/_smoke");
}

function getFirebaseData() {
  var url = FB_URL + "daily_logs.json?auth=" + FB_SECRET;
  try {
    var response = UrlFetchApp.fetch(url);
    var result = JSON.parse(response.getContentText());
    return result;
  } catch (e) { return null; }
}

function loginUser(phoneInput, passwordInput) {
  try {
    var ss = SpreadsheetApp.openById(TEACHER_SS_ID);
    var cleanInputPhone = String(phoneInput).replace(/[^0-9]/g, ''); 
    var cleanInputPw = String(passwordInput).trim();
    if (/^\d+$/.test(cleanInputPw.replace(/-/g, ''))) cleanInputPw = cleanInputPw.replace(/[^0-9]/g, '');

    var teacherSheet = ss.getSheetByName('Teachers');
    if (!teacherSheet) return { success: false, message: 'Teachers 시트를 찾을 수 없습니다.' };
    var infoSheet = ss.getSheetByName('BasicInfo');
    
    var commonInfo = [];
    if (infoSheet) {
      try {
        var infoData = infoSheet.getDataRange().getDisplayValues();
        for(var i=1; i<infoData.length; i++) {
          if(infoData[i][0]) commonInfo.push({ label: infoData[i][0], value: infoData[i][1] });
        }
      } catch(e) {}
    }

    // [추가] 학생 정보 읽어오기 (student 탭)
    var studentList = [];
    try {
        var studentSheet = ss.getSheetByName('student'); 
        if (studentSheet) {
            var sData = studentSheet.getDataRange().getDisplayValues();
            // 1행은 헤더이므로 2행(인덱스 1)부터 시작
            for (var k = 1; k < sData.length; k++) {
                var rawName = String(sData[k][0]); // 이름 필드 (예: /홍길동)
                var school = String(sData[k][1]);  // 학교 필드
                var grade = String(sData[k][2]);   // 학년 필드

                if (rawName) {
                    // 이름 앞 '/' 제거
                    var cleanName = rawName.replace(/^\//, '').trim();
                    
                    // 학년 '3@' -> '재수생' 변환
                    if (grade === '3@') grade = '재수생';
                    
                    studentList.push({ name: cleanName, school: school, grade: grade });
                }
            }
        }
    } catch (e) { /* 학생 시트 오류 무시 */ }

    var notices = [];
    try {
        var noticeSheet = SpreadsheetApp.openById(ATTENDANCE_SS_ID).getSheetByName('Notice');
        if(noticeSheet) {
            var nData = noticeSheet.getDataRange().getDisplayValues();
            for(var k=1; k<nData.length; k++) {
                if(nData[k][1]) notices.push({ type: nData[k][0], content: nData[k][1] });
            }
        }
    } catch(e) {}

    var data = teacherSheet.getDataRange().getDisplayValues();
    
    // [관리자 목록]
    var ADMIN_PHONES = ['01086262428', '01052259356', '01033934700', '01089945993', '01042327428']; 
    var ADMIN_NAMES = ['안종성', '안준성', '김용찬', '홍성우', '에스에듀']; 

    for (var i = 1; i < data.length; i++) {
      var sheetPhoneClean = String(data[i][0]).replace(/[^0-9]/g, '');
      if ((sheetPhoneClean === cleanInputPhone) || (cleanInputPhone.length >= 8 && sheetPhoneClean.endsWith(cleanInputPhone))) {
        
        var storedPw = String(data[i][6]).trim();
        var isFirstLogin = (storedPw === "");
        var storedPwClean = String(storedPw).replace(/[^0-9a-zA-Z!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, '');
        var isPwMatch = isFirstLogin
          ? (cleanInputPhone.slice(-8) === sheetPhoneClean.slice(-8))
          : (storedPw === passwordInput || storedPw === cleanInputPw || storedPwClean === cleanInputPw);
        
        if (isPwMatch) {
          var userName = String(data[i][1]).trim();
          var isAdmin = ADMIN_PHONES.includes(sheetPhoneClean) || ADMIN_NAMES.includes(userName);
          
          var teacherList = [];
          if (isAdmin) {
             for (var j = 1; j < data.length; j++) {
               if (data[j][1]) {
                 var tLog = data[j][3];
                 if(!tLog || tLog === "") tLog = data[j][4];
                 teacherList.push({ 
                   name: data[j][1], 
                   subject: data[j][2] || "",
                   phone: data[j][0],
                   links: { log: tLog||"", task: data[j][4]||"", hours: data[j][5]||"" }
                 });
               }
             }
          }

          var myLog = data[i][3];
          if(!myLog || myLog === "") myLog = data[i][4];

          return { 
            success: true, 
            name: userName, 
            subject: data[i][2], 
            links: { log: myLog||"", task: data[i][4]||"", hours: data[i][5]||"" }, 
            common: commonInfo,
            notices: notices,
            isFirstLogin: isFirstLogin, 
            isAdmin: isAdmin, 
            teacherList: teacherList,
            studentList: studentList // [핵심] 학생 데이터 전달
          };
        } else {
          return { success: false, message: '비밀번호가 일치하지 않습니다.' };
        }
      }
    }
    return { success: false, message: '등록되지 않은 번호입니다.' };
  } catch (e) { return { success: false, message: '시스템 오류: ' + e.message }; }
}

function syncToFirebase() {
  var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
  var sheets = ss.getSheets();
  var jsonData = {};
  
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var name = sheet.getName();
    if (!name.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    
    var data = sheet.getDataRange().getDisplayValues();
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[2] || !row[7]) continue; 
      
      var hours = 0;
      if(row[10]) { var match = String(row[10]).match(/[\d.]+/); if(match) hours = parseFloat(match[0]); }
      
      var teacherName = String(row[7]).trim();
      var key = name.replace(/-/g, '') + '_' + i; 
      
      var rawStudent = String(row[2]).trim();
      while(rawStudent.startsWith('/')) rawStudent = rawStudent.substring(1);
      
      var parts = rawStudent.split('/');
      var sName = parts[0].trim();
      var sSchool = parts[1] ? parts[1].trim() : (row[3] || ""); 
      var sGrade = parts[2] ? parts[2].trim() : (row[4] || ""); 

      jsonData[key] = { 
        date: name, 
        category: row[1], 
        student: sName,   
        school: sSchool,  
        grade: sGrade,    
        raw: rawStudent,  
        status: row[5], 
        teacher: teacherName, 
        start: row[8], 
        end: row[9], 
        hours: hours, 
        note: row[11] 
      };
    }
  }

  var url = FB_URL + "daily_logs.json?auth=" + FB_SECRET;
  var options = { method: "put", contentType: "application/json", payload: JSON.stringify(jsonData) };
  try { UrlFetchApp.fetch(url, options); return {success: true}; } 
  catch(e) { return {success: false, message: e.message}; }
}

function saveAttendanceData(payload) {
  try {
    if (!payload || !payload.date) return { success: false, message: '요청 데이터가 올바르지 않습니다.' };
    if (!payload.students || !payload.students.length) return { success: false, message: '학생 정보가 없습니다.' };

    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
    var dateObj = new Date(payload.date);
    if (isNaN(dateObj.getTime())) return { success: false, message: '날짜 형식이 올바르지 않습니다.' };
    var dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var sheet = ss.getSheetByName(dateStr);
    
    if (!sheet) {
        var template = ss.getSheetByName('Daily_Log_Template') || ss.getSheetByName('Template');
        if(template) sheet = template.copyTo(ss).setName(dateStr);
        else return { success: false, message: '템플릿 시트가 없습니다.' };
    }
    
    var days = ['일','월','화','수','목','금','토'];
    var displayDate = (dateObj.getMonth()+1) + '/' + dateObj.getDate() + '(' + days[dateObj.getDay()] + ')';
    
    for(var k=0; k<payload.students.length; k++) {
      var student = String(payload.students[k] || "").trim();
      if (!student) continue;
      var newRow = [displayDate, payload.category, student, "", "", payload.status, "반포", payload.teacher, payload.start, payload.end, payload.hours, payload.note];
      sheet.appendRow(newRow);
    }
    
    syncToFirebase(); 
    return { success: true };
  } catch(e) { return { success: false, message: '저장 실패: ' + e.message }; }
}

function changePassword(phoneInput, newPassword) {
  var ss = SpreadsheetApp.openById(TEACHER_SS_ID);
  var sheet = ss.getSheetByName('Teachers');
  if (!sheet) return { success: false, message: 'Teachers 시트를 찾을 수 없습니다.' };
  var data = sheet.getDataRange().getValues();
  var targetPhone = String(phoneInput).replace(/\D/g, '');
  if (targetPhone.length < 8) return { success: false, message: '전화번호가 올바르지 않습니다.' };
  for (var i = 1; i < data.length; i++) {
    var rowPhone = String(data[i][0]).replace(/\D/g, '');
    if (rowPhone === targetPhone || rowPhone.slice(-8) === targetPhone.slice(-8)) {
      sheet.getRange(i + 1, 7).setValue(newPassword);
      return { success: true };
    }
  }
  return { success: false, message: '대상 사용자를 찾을 수 없습니다.' };
}

function getNoticeData() {
  try {
    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID); 
    var sheet = ss.getSheetByName('Notice');
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var result = [];
    for(var i=0; i<data.length; i++) if(data[i][1]) result.push({ type: data[i][0], content: data[i][1] });
    return result;
  } catch (e) { return []; }
}

function reviewDailyAttendance(dateInput) {
  try {
    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
    var tz = Session.getScriptTimeZone();
    var d = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(d.getTime())) return { success: false, message: '날짜 형식이 올바르지 않습니다.' };
    var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    var sheet = ss.getSheetByName(dateStr);
    if (!sheet) return { success: true, date: dateStr, rows: 0, issues: [], summary: { critical: 0, warning: 0 } };

    var data = sheet.getDataRange().getDisplayValues();
    var issues = [];
    var summary = { critical: 0, warning: 0 };
    var rows = Math.max(0, data.length - 1);

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var line = i + 1;
      var category = String(row[1] || '').trim();
      var student = String(row[2] || '').trim();
      var status = String(row[5] || '').trim();
      var teacher = String(row[7] || '').trim();
      var start = String(row[8] || '').trim();
      var end = String(row[9] || '').trim();
      var hours = parseHours_(row[10]);

      // 일일 합계/구분선 행 등 실제 수업 레코드가 아닌 행은 검토 제외
      if (!isReviewTargetRow_(category, teacher, student, status, start, end)) continue;

      if (!status) pushIssue_(issues, summary, 'critical', line, '출결 미입력', '출결 상태(F열)가 비어 있습니다.');
      if (!student) pushIssue_(issues, summary, 'warning', line, '학생명 미입력', '학생명(C열)이 비어 있습니다.');
      if (!start || !end) pushIssue_(issues, summary, 'warning', line, '수업 시간 미입력', '시작/종료 시간(I/J열)이 비어 있습니다.');

      var parsed = parseTimeRangeHours_(start, end);
      if (parsed > 0) {
        if (parsed > 4.5 || parsed < 1.5) {
          pushIssue_(
            issues,
            summary,
            'warning',
            line,
            '비정상 수업 시간',
            '수업: ' + (category || '-') + ' / 학생: ' + (student || '-') + ' / 시간: ' + start + '~' + end + ' / 계산: ' + parsed.toFixed(1) + 'H'
          );
        }
        if (hours > 0 && Math.abs(hours - parsed) >= 0.2) {
          pushIssue_(issues, summary, 'warning', line, '시간 불일치', '입력 시수(K열)와 시작/종료 시간 계산값이 다릅니다. 입력: ' + hours.toFixed(1) + 'H / 계산: ' + parsed.toFixed(1) + 'H');
        }
      }

      var nameFromCategory = extractTeacherFromCategory_(category);
      var teacherNorm = normalizeName_(teacher);
      if (nameFromCategory && teacherNorm) {
        if (!(teacherNorm.indexOf(nameFromCategory) > -1 || nameFromCategory.indexOf(teacherNorm) > -1)) {
          pushIssue_(issues, summary, 'critical', line, '강사명 불일치', '수업명(B열) 내 강사명과 TR 강사명(H열)이 다릅니다. B열: ' + category + ' / H열: ' + teacher);
        }
      }
    }

    return { success: true, date: dateStr, rows: rows, issues: issues, summary: summary };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function parseHours_(value) {
  var m = String(value || '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function parseTimeRangeHours_(start, end) {
  var s = parseTimeToMinutes_(start);
  var e = parseTimeToMinutes_(end);
  if (s < 0 || e < 0 || e <= s) return 0;
  return (e - s) / 60;
}

function parseTimeToMinutes_(raw) {
  if (!raw) return -1;
  var text = String(raw).trim();
  var m = text.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return -1;
  var hour = parseInt(m[2], 10);
  var min = parseInt(m[3], 10);
  if (isNaN(hour) || isNaN(min)) return -1;
  if (m[1] === '오전' && hour === 12) hour = 0;
  if (m[1] === '오후' && hour < 12) hour += 12;
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return -1;
  return hour * 60 + min;
}

function normalizeName_(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/선생님|teacher|강사|TR|T/gi, '')
    .replace(/[^가-힣A-Za-z]/g, '')
    .trim();
}

function extractTeacherFromCategory_(category) {
  var text = String(category || '').trim();
  if (!text) return '';

  // 1순위: 괄호 내 마지막 값 (예: 국어-개별(남중언)-1h -> 남중언)
  var re = /\(([^()]*)\)/g;
  var match;
  var last = '';
  while ((match = re.exec(text)) !== null) last = match[1];
  if (last) return normalizeName_(last);

  // 2순위: 하이픈 분리 후 시간 토큰 제외한 마지막 텍스트
  var parts = text.split('-').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
  for (var i = parts.length - 1; i >= 0; i--) {
    var token = parts[i];
    if (/^\d+(\.\d+)?\s*(h|시간)$/i.test(token)) continue;
    var norm = normalizeName_(token);
    if (norm) return norm;
  }
  return '';
}

function pushIssue_(issues, summary, severity, line, title, detail) {
  issues.push({ severity: severity, line: line, title: title, detail: detail });
  if (severity === 'critical') summary.critical++;
  else summary.warning++;
}

function isReviewTargetRow_(category, teacher, student, status, start, end) {
  // 비수업 합계행(예: F열에 숫자만 있고 나머지 공백) 제외
  if (!category && !teacher && !student && !start && !end) return false;

  // "총 시수" 성격의 요약 행 제외
  if (!category && !teacher && !start && !end && /^\d+(\.\d+)?$/.test(String(status || '').trim())) return false;

  return true;
}

function saveClassLogRows(payload) {
  try {
    if (!payload || !payload.rows || !payload.rows.length) {
      return { success: false, message: '저장할 수업일지 데이터가 없습니다.' };
    }

    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
    var sheet = ss.getSheetByName('Class Log');
    if (!sheet) return { success: false, message: 'Class Log 시트를 찾을 수 없습니다.' };

    var tz = Session.getScriptTimeZone();
    var values = [];
    var incoming = {};
    for (var i = 0; i < payload.rows.length; i++) {
      var r = payload.rows[i];
      var teacher = String(r.teacher || '').replace(/\s*T$/i, '').trim();
      var student = String(r.student || '').trim();
      var dateText = String(r.date || '').trim();
      var status = String(r.logStatus || '').trim();
      var reason = String(r.reason || '').trim();

      if (!teacher || !student || !dateText || !status) continue;

      var d = new Date(dateText);
      var dateValue = isNaN(d.getTime()) ? dateText : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var key = [teacher, student, dateValue].join('|');
      incoming[key] = [teacher, student, dateValue, status, reason];
    }

    for (var k in incoming) values.push(incoming[k]);
    if (!values.length) return { success: false, message: '유효한 행이 없어 저장하지 못했습니다.' };

    // 같은 강사/학생/일자 키가 이미 있으면 업데이트, 없으면 append
    var lastRow = sheet.getLastRow();
    var existingMap = {};
    if (lastRow >= 2) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 5).getDisplayValues();
      for (var e = 0; e < existing.length; e++) {
        var er = existing[e];
        var exTeacher = String(er[0] || '').replace(/\s*T$/i, '').trim();
        var exStudent = String(er[1] || '').trim();
        var exDateRaw = String(er[2] || '').trim();
        var exDate = exDateRaw;
        var exParsed = new Date(exDateRaw);
        if (!isNaN(exParsed.getTime())) exDate = Utilities.formatDate(exParsed, tz, 'yyyy-MM-dd');
        var exKey = [exTeacher, exStudent, exDate].join('|');
        if (!existingMap[exKey]) existingMap[exKey] = [];
        existingMap[exKey].push(e + 2);
      }
    }

    var appendValues = [];
    for (var v = 0; v < values.length; v++) {
      var row = values[v];
      var rowKey = [row[0], row[1], row[2]].join('|');
      var rowsToUpdate = existingMap[rowKey] || [];
      if (rowsToUpdate.length) {
        for (var u = 0; u < rowsToUpdate.length; u++) {
          sheet.getRange(rowsToUpdate[u], 4, 1, 2).setValues([[row[3], row[4]]]);
        }
      } else {
        appendValues.push(row);
      }
    }
    if (appendValues.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appendValues.length, 5).setValues(appendValues);
    }
    invalidateClassLogOverviewCache_(values);
    return { success: true, count: values.length };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getClassLogMonthlyOverview(payload) {
  try {
    var now = new Date();
    var year = parseInt((payload && payload.year) || now.getFullYear(), 10);
    var month = parseInt((payload && payload.month) || (now.getMonth() + 1), 10); // 1-12
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return { success: false, message: '조회 월 정보가 올바르지 않습니다.' };
    }

    var cacheKey = 'classlog_overview_' + year + '_' + month;
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e0) {}
    }

    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
    var tz = Session.getScriptTimeZone();
    var first = new Date(year, month - 1, 1);
    var daysInMonth = new Date(year, month, 0).getDate();

    var taughtMap = {}; // key: yyyy-MM-dd|teacher => {count, hours, students:{}, lessons:[]}

    for (var d = 1; d <= daysInMonth; d++) {
      var dateObj = new Date(year, month - 1, d);
      var dateKey = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
      var sheet = ss.getSheetByName(dateKey);
      if (!sheet) continue;
      var data = sheet.getDataRange().getDisplayValues();
      if (!data || data.length < 2) continue;

      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var category = String(row[1] || '').trim();
        var student = String(row[2] || '').trim();
        var status = String(row[5] || '').trim();
        var teacherRaw = String(row[7] || '').trim();
        var start = String(row[8] || '').trim();
        var end = String(row[9] || '').trim();
        var hours = parseHours_(row[10]);

        if (!isReviewTargetRow_(category, teacherRaw, student, status, start, end)) continue;
        if (!teacherRaw) continue;
        if (status === '당일취소' || status.indexOf('예고') > -1) continue;

        if (hours <= 0) hours = parseTimeRangeHours_(start, end);
        if (hours <= 0) continue;

        var teacher = normalizeTeacherDisplay_(teacherRaw);
        var tk = dateKey + '|' + teacher;
        if (!taughtMap[tk]) taughtMap[tk] = { count: 0, hours: 0, students: {}, lessons: [] };
        taughtMap[tk].count += 1;
        taughtMap[tk].hours += hours;
        if (student) taughtMap[tk].students[student] = true;
        taughtMap[tk].lessons.push({
          student: student,
          status: status,
          start: start,
          end: end,
          time: compactTimeRange_(start, end),
          className: category,
          hours: Math.round(hours * 10) / 10
        });
      }
    }

    var classLogSheet = ss.getSheetByName('Class Log');
    if (!classLogSheet) return { success: false, message: 'Class Log 시트를 찾을 수 없습니다.' };

    var logMap = {}; // key: yyyy-MM-dd|teacher => {total, submitted, missing, reasons:{}, entries:[]}
    var lr = classLogSheet.getLastRow();
    if (lr >= 2) {
      var logs = classLogSheet.getRange(2, 1, lr - 1, 5).getDisplayValues();
      for (var j = 0; j < logs.length; j++) {
        var r = logs[j];
        var tName = normalizeTeacherDisplay_(r[0]);
        var dateRaw = String(r[2] || '').trim();
        var st = String(r[3] || '').trim();
        var reason = String(r[4] || '').trim();
        if (!tName || !dateRaw) continue;

        var dObj = new Date(dateRaw);
        var dKey = isNaN(dObj.getTime()) ? dateRaw : Utilities.formatDate(dObj, tz, 'yyyy-MM-dd');
        if (dKey.slice(0, 7) !== Utilities.formatDate(first, tz, 'yyyy-MM')) continue;

        var lk = dKey + '|' + tName;
        if (!logMap[lk]) logMap[lk] = { total: 0, submitted: 0, missing: 0, reasons: {}, entries: [] };
        logMap[lk].total += 1;
        logMap[lk].entries.push({
          student: String(r[1] || '').trim(),
          status: st,
          reason: reason
        });
        if (st === '미제출') {
          logMap[lk].missing += 1;
          if (reason) logMap[lk].reasons[reason] = true;
        } else {
          logMap[lk].submitted += 1;
        }
      }
    }

    var dayMap = {};
    for (var day = 1; day <= daysInMonth; day++) {
      var dayObj = new Date(year, month - 1, day);
      var dayKey = Utilities.formatDate(dayObj, tz, 'yyyy-MM-dd');
      var teacherSet = {};

      var seenKeys = Object.keys(taughtMap);
      for (var a = 0; a < seenKeys.length; a++) {
        if (seenKeys[a].indexOf(dayKey + '|') === 0) teacherSet[seenKeys[a].split('|')[1]] = true;
      }
      var logKeys = Object.keys(logMap);
      for (var b = 0; b < logKeys.length; b++) {
        if (logKeys[b].indexOf(dayKey + '|') === 0) teacherSet[logKeys[b].split('|')[1]] = true;
      }

      var teachers = Object.keys(teacherSet).sort(function(x, y) { return x.localeCompare(y, 'ko'); });
      var rows = [];
      var missingTeachers = [];
      var submittedTeachers = [];
      var partialTeachers = [];
      var noLogTeachers = [];

      for (var t = 0; t < teachers.length; t++) {
        var teacherName = teachers[t];
        var key = dayKey + '|' + teacherName;
        var taught = taughtMap[key] || { count: 0, hours: 0, students: {}, lessons: [] };
        var log = logMap[key] || { total: 0, submitted: 0, missing: 0, reasons: {}, entries: [] };
        var hasClass = taught.count > 0;
        var statusLabel = '기록 없음';
        if (hasClass) {
          if (log.total === 0) statusLabel = '기록없음';
          else if (log.missing > 0 && log.submitted > 0) statusLabel = '부분 미제출';
          else if (log.missing > 0) statusLabel = '미제출';
          else statusLabel = '제출 완료';
        } else if (log.total > 0) {
          statusLabel = '기록만 존재';
        }

        if (hasClass && statusLabel === '제출 완료') submittedTeachers.push(teacherName);
        if (hasClass && statusLabel === '미제출') missingTeachers.push(teacherName);
        if (hasClass && statusLabel === '부분 미제출') partialTeachers.push(teacherName);
        if (hasClass && statusLabel === '기록없음') noLogTeachers.push(teacherName);

        rows.push({
          teacher: teacherName,
          hasClass: hasClass,
          taughtCount: taught.count,
          taughtHours: Math.round(taught.hours * 10) / 10,
          logCount: log.total,
          submittedCount: log.submitted,
          missingCount: log.missing,
          reasons: Object.keys(log.reasons),
          logEntries: log.entries,
          taughtStudents: Object.keys(taught.students || {}),
          taughtLessons: taught.lessons || [],
          status: statusLabel
        });
      }

      dayMap[dayKey] = {
        dateKey: dayKey,
        day: day,
        teachers: rows,
        taughtTeacherCount: submittedTeachers.length + missingTeachers.length + partialTeachers.length + noLogTeachers.length,
        submittedTeacherCount: submittedTeachers.length,
        missingTeacherCount: missingTeachers.length,
        partialTeacherCount: partialTeachers.length,
        noLogTeacherCount: noLogTeachers.length,
        missingTeachers: missingTeachers,
        partialTeachers: partialTeachers,
        noLogTeachers: noLogTeachers
      };
    }

    var result = {
      success: true,
      year: year,
      month: month,
      daysInMonth: daysInMonth,
      dayMap: dayMap
    };
    cache.put(cacheKey, JSON.stringify(result), 300);
    return result;
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function invalidateClassLogOverviewCache_(rows) {
  try {
    var cache = CacheService.getScriptCache();
    if (!rows || !rows.length) return;
    for (var i = 0; i < rows.length; i++) {
      var dateText = String(rows[i][2] || '').trim();
      if (!dateText) continue;
      var d = new Date(dateText);
      if (isNaN(d.getTime())) continue;
      var key = 'classlog_overview_' + d.getFullYear() + '_' + (d.getMonth() + 1);
      cache.remove(key);
    }
  } catch (e) {}
}

function compactTimeRange_(start, end) {
  var s = compactTimeLabel_(start);
  var e = compactTimeLabel_(end);
  if (!s && !e) return '';
  if (!e) return s;
  if (!s) return e;
  return s + '~' + e;
}

function compactTimeLabel_(raw) {
  var text = String(raw || '').trim();
  if (!text) return '';
  var m = text.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return text;
  var hour = parseInt(m[2], 10);
  var min = String(m[3] || '00');
  var ampm = m[1] || '';
  if (!ampm) {
    if (hour === 0) { ampm = '오전'; hour = 12; }
    else if (hour < 12) ampm = '오전';
    else if (hour === 12) ampm = '오후';
    else { ampm = '오후'; hour -= 12; }
  } else {
    if (ampm === '오전' && hour === 0) hour = 12;
    if (ampm === '오후' && hour > 12) hour -= 12;
  }
  return ampm + ' ' + hour + ':' + min;
}

function normalizeTeacherDisplay_(name) {
  return String(name || '')
    .replace(/\s*T$/i, '')
    .replace(/선생님|teacher|강사|TR/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

function getEventCalendarData(payload) {
  try {
    var now = new Date();
    var year = parseInt((payload && payload.year) || now.getFullYear(), 10);
    var month = parseInt((payload && payload.month) || (now.getMonth() + 1), 10); // 1-12
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return { success: false, message: '조회 월 정보가 올바르지 않습니다.' };
    }

    var ss = SpreadsheetApp.openById(ATTENDANCE_SS_ID);
    var sheet = ss.getSheetByName('event') || ss.getSheetByName('Event');
    if (!sheet) return { success: true, year: year, month: month, events: [], dayMap: {} };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, year: year, month: month, events: [], dayMap: {} };

    var tz = Session.getScriptTimeZone();
    var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues(); // 날짜, 대상, 이벤트명, 비고
    var displays = sheet.getRange(2, 1, lastRow - 1, 4).getDisplayValues();
    var events = [];
    var dayMap = {};

    for (var i = 0; i < values.length; i++) {
      var dateCell = values[i][0];
      var dateObj = null;
      if (Object.prototype.toString.call(dateCell) === '[object Date]' && !isNaN(dateCell.getTime())) {
        dateObj = new Date(dateCell.getFullYear(), dateCell.getMonth(), dateCell.getDate());
      } else {
        var text = String(displays[i][0] || '').trim();
        if (!text) continue;
        var parsed = new Date(text);
        if (!isNaN(parsed.getTime())) dateObj = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      }
      if (!dateObj) continue;
      if (dateObj.getFullYear() !== year || dateObj.getMonth() !== (month - 1)) continue;

      var dateKey = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
      var row = {
        dateKey: dateKey,
        day: dateObj.getDate(),
        target: String(displays[i][1] || '').trim(),
        title: String(displays[i][2] || '').trim(),
        note: String(displays[i][3] || '').trim()
      };
      if (!row.title && !row.target && !row.note) continue;
      events.push(row);
      if (!dayMap[dateKey]) dayMap[dateKey] = [];
      dayMap[dateKey].push(row);
    }

    events.sort(function(a, b) {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
      return String(a.title).localeCompare(String(b.title), 'ko');
    });

    return { success: true, year: year, month: month, events: events, dayMap: dayMap };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getPayrollBootstrapData() {
  try {
    var monthSheets = getPayrollMonthSheetNames_();
    if (!monthSheets.length) {
      return { success: false, message: "급여 정산 월 탭(예: 26-02)을 찾을 수 없습니다." };
    }

    var selectedMonth = monthSheets[0];
    var summary = getPayrollMonthSummary({
      monthName: selectedMonth,
      teacherName: "",
      salaryMode: "ratio",
      ratioPercent: 50,
      hourlyRate: 0,
      freeIncludedRowKeys: []
    });
    if (!summary || !summary.success) return summary;

    return {
      success: true,
      months: monthSheets,
      selectedMonth: selectedMonth,
      teachers: summary.teachers || [],
      summary: summary
    };
  } catch (e) {
    return { success: false, message: "초기 데이터 로드 오류: " + e.message };
  }
}

function getTuitionBootstrapData() {
  try {
    var months = getTuitionMonthSheetNames_();
    if (!months.length) {
      return { success: false, message: "수강료 월 탭(예: 26-02s)을 찾을 수 없습니다." };
    }
    var selectedMonth = months[0];
    var summary = getTuitionMonthSummary({ monthName: selectedMonth, statusFilter: "", keyword: "" });
    if (!summary || !summary.success) return summary;
    return {
      success: true,
      months: months,
      selectedMonth: selectedMonth,
      summary: summary
    };
  } catch (e) {
    return { success: false, message: "수강료 초기 데이터 로드 오류: " + e.message };
  }
}

function getTuitionMonthSummary(payload) {
  try {
    var req = payload || {};
    var months = getTuitionMonthSheetNames_();
    if (!months.length) {
      return { success: false, message: "수강료 월 탭(예: 26-02s)을 찾을 수 없습니다." };
    }
    var monthName = String(req.monthName || months[0]).trim();
    var statusFilter = String(req.statusFilter || "").trim();
    var keyword = String(req.keyword || "").trim().toLowerCase();
    var ss = getPayrollSpreadsheet_();
    var paymentRows = [];
    var todayRows = [];
    var now = new Date();
    var todayMonthDay = ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
    months.forEach(function(srcMonth) {
      var srcSheet = ss.getSheetByName(srcMonth);
      if (!srcSheet) return;
      var srcRows = parseTuitionRows_(srcSheet);
      srcRows.forEach(function(row) {
        var rowWithSource = {};
        Object.keys(row).forEach(function(k) { rowWithSource[k] = row[k]; });
        rowWithSource.sourceMonth = srcMonth;
        var dueMonth = parseTuitionDueMonthName_(row.dueDate);
        if (dueMonth && dueMonth === monthName) {
          paymentRows.push(rowWithSource);
        }
        var paidMonthDay = extractTuitionMonthDay_(row.paidAt);
        if (paidMonthDay && paidMonthDay === todayMonthDay) {
          todayRows.push(rowWithSource);
        }
      });
    });
    var paymentStudentMap = {};
    paymentRows.forEach(function(row) {
      var pkey = normalizeTuitionStudentName_(row.studentName);
      if (!pkey) return;
      paymentStudentMap[pkey] = true;
    });
    var classStudentMap = loadTuitionClassStudentMapByMonth_(monthName);
    var studentRows = loadTuitionStudentMaster_();
    var followupMap = loadTuitionFollowupMap_(monthName);

    var studentMap = {};
    studentRows.forEach(function(row) {
      var key = normalizeTuitionStudentName_(row.name);
      if (!key) return;
      if (classStudentMap && !classStudentMap[key] && !paymentStudentMap[key]) return;
      studentMap[key] = {
        studentName: row.name,
        school: row.school,
        grade: row.grade,
        guideAmount: 0,
        collectedAmount: 0,
        paymentCount: 0,
        latestPaidAt: "",
        latestBusiness: "",
        latestMethod: "",
        latestApprovalNo: "",
        unpaidStatus: "안내이전",
        contactCount: 0,
        lastContactAt: "",
        lastContactMemo: "",
        lastUpdatedAt: ""
      };
    });

    paymentRows.forEach(function(row) {
      var key = normalizeTuitionStudentName_(row.studentName);
      if (!key) return;
      var target = studentMap[key];
      // student 탭 '등록 상태' 체크된 학생만 재원생 수강료 정산 대상에 포함
      if (!target) return;
      // 받은 금액은 음수, 환불은 양수 -> 수납 실적은 -금액의 합
      target.collectedAmount += (0 - row.amount);
      target.paymentCount += 1;
      if (!target.latestPaidAt || String(row.paidAt || "") > String(target.latestPaidAt || "")) {
        target.latestPaidAt = row.paidAt || "";
        target.latestBusiness = row.business || "";
        target.latestMethod = row.paymentType || "";
        target.latestApprovalNo = row.approvalNo || "";
      }
    });

    Object.keys(studentMap).forEach(function(key) {
      var target = studentMap[key];
      var follow = followupMap[key];
      if (follow) {
        target.guideAmount = Math.max(0, toPayrollNumber_(follow.guideAmount));
        target.unpaidStatus = normalizeTuitionUnpaidStatus_(follow.unpaidStatus);
        target.contactCount = Math.max(0, parseInt(follow.contactCount || 0, 10) || 0);
        target.lastContactAt = String(follow.lastContactAt || "");
        target.lastContactMemo = String(follow.lastContactMemo || "");
        target.lastUpdatedAt = String(follow.lastUpdatedAt || "");
      }

      if (target.collectedAmount > 0 || (target.guideAmount > 0 && target.collectedAmount >= target.guideAmount)) {
        target.unpaidStatus = "납부완료";
      } else if (!follow) {
        target.unpaidStatus = "안내이전";
      }

      target.guideAmount = Math.round(target.guideAmount || 0);
      target.collectedAmount = Math.round(target.collectedAmount || 0);
      target.outstandingAmount = Math.max(0, Math.round((target.guideAmount || 0) - (target.collectedAmount || 0)));
    });

    var list = Object.keys(studentMap).map(function(key) {
      var row = studentMap[key];
      row.studentKey = key;
      return row;
    }).filter(function(row) {
      if (statusFilter && row.unpaidStatus !== statusFilter) return false;
      if (keyword) {
        var blob = [row.studentName, row.school, row.grade, row.unpaidStatus].join(" ").toLowerCase();
        if (blob.indexOf(keyword) === -1) return false;
      }
      return true;
    }).sort(function(a, b) {
      var aDone = a.unpaidStatus === "납부완료" || a.unpaidStatus === "이월금";
      var bDone = b.unpaidStatus === "납부완료" || b.unpaidStatus === "이월금";
      if (aDone && !bDone) return 1;
      if (!aDone && bDone) return -1;
      return String(a.studentName || "").localeCompare(String(b.studentName || ""), "ko");
    });

    var summary = buildTuitionSummaryStats_(list, paymentRows);
    return {
      success: true,
      selectedMonth: monthName,
      months: months,
      kpi: summary.kpi,
      chart: summary.chart,
      allPayments: summary.allPayments || paymentRows,
      todayPayments: todayRows,
      payments: summary.payments,
      rows: list
    };
  } catch (e) {
    return { success: false, message: "수강료 데이터 계산 오류: " + e.message };
  }
}

function saveTuitionFollowup(payload) {
  try {
    var req = payload || {};
    var monthName = String(req.monthName || "").trim();
    var studentName = normalizeTuitionStudentName_(req.studentName);
    if (!monthName) return { success: false, message: "월 정보가 없습니다." };
    if (!studentName) return { success: false, message: "학생명이 없습니다." };

    var guideAmount = Math.max(0, Math.round(toPayrollNumber_(req.guideAmount)));
    var unpaidStatus = normalizeTuitionUnpaidStatus_(req.unpaidStatus);
    var memo = String(req.memo || "").trim();
    var now = new Date();
    var nowIso = now.toISOString();

    var ss = getPayrollSpreadsheet_();
    var sheet = ensureTuitionFollowupSheet_(ss);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var index = buildTuitionHeaderIndex_(headers, {
      monthName: ["월"],
      studentName: ["학생명"],
      guideAmount: ["안내금액"],
      unpaidStatus: ["미납상태"],
      lastContactAt: ["마지막연락일시"],
      lastContactMemo: ["마지막연락메모"],
      contactCount: ["연락횟수"],
      lastUpdatedAt: ["마지막수정일시"]
    });

    var lastRow = sheet.getLastRow();
    var rowNo = -1;
    var currentContactCount = 0;
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var monthCell = String(data[i][index.monthName] || "").trim();
        var nameCell = normalizeTuitionStudentName_(data[i][index.studentName]);
        if (monthCell === monthName && nameCell === studentName) {
          rowNo = i + 2;
          currentContactCount = parseInt(data[i][index.contactCount] || "0", 10) || 0;
          break;
        }
      }
    }

    if (rowNo < 0) {
      rowNo = lastRow + 1;
      currentContactCount = 0;
    }
    var contactCount = currentContactCount + 1;

    var write = [];
    write[index.monthName] = monthName;
    write[index.studentName] = studentName;
    write[index.guideAmount] = guideAmount;
    write[index.unpaidStatus] = unpaidStatus;
    write[index.lastContactAt] = nowIso;
    write[index.lastContactMemo] = memo;
    write[index.contactCount] = contactCount;
    write[index.lastUpdatedAt] = nowIso;

    for (var c = 0; c < sheet.getLastColumn(); c++) {
      if (typeof write[c] === "undefined") write[c] = "";
    }
    sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).setValues([write]);

    var logSheet = ensureTuitionContactLogSheet_(ss);
    logSheet.appendRow([monthName, studentName, guideAmount, unpaidStatus, memo, nowIso]);

    return { success: true, contactAt: nowIso, contactCount: contactCount };
  } catch (e) {
    return { success: false, message: "연락기록 저장 오류: " + e.message };
  }
}

function saveTuitionStatusOnly(payload) {
  try {
    var req = payload || {};
    var monthName = String(req.monthName || "").trim();
    var studentName = normalizeTuitionStudentName_(req.studentName);
    if (!monthName) return { success: false, message: "월 정보가 없습니다." };
    if (!studentName) return { success: false, message: "학생명이 없습니다." };

    var ss = getPayrollSpreadsheet_();
    var sheet = ensureTuitionFollowupSheet_(ss);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var index = buildTuitionHeaderIndex_(headers, {
      monthName: ["월"],
      studentName: ["학생명"],
      guideAmount: ["안내금액"],
      unpaidStatus: ["미납상태"],
      lastContactAt: ["마지막연락일시"],
      lastContactMemo: ["마지막연락메모"],
      contactCount: ["연락횟수"],
      lastUpdatedAt: ["마지막수정일시"]
    });

    var lastRow = sheet.getLastRow();
    var rowNo = -1;
    var currentRow = null;
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
      for (var i = 0; i < data.length; i++) {
        var monthCell = String(data[i][index.monthName] || "").trim();
        var nameCell = normalizeTuitionStudentName_(data[i][index.studentName]);
        if (monthCell === monthName && nameCell === studentName) {
          rowNo = i + 2;
          currentRow = data[i];
          break;
        }
      }
    }

    if (rowNo < 0) rowNo = lastRow + 1;
    var nowIso = new Date().toISOString();
    var guideAmount = Math.max(0, Math.round(toPayrollNumber_(req.guideAmount)));
    if ((!guideAmount || guideAmount < 0) && currentRow) {
      guideAmount = Math.max(0, Math.round(toPayrollNumber_(currentRow[index.guideAmount])));
    }
    var unpaidStatus = normalizeTuitionUnpaidStatus_(req.unpaidStatus);
    var contactCount = currentRow ? (parseInt(currentRow[index.contactCount] || "0", 10) || 0) : 0;
    var lastContactAt = currentRow ? String(currentRow[index.lastContactAt] || "") : "";
    var lastContactMemo = currentRow ? String(currentRow[index.lastContactMemo] || "") : "";

    var write = [];
    write[index.monthName] = monthName;
    write[index.studentName] = studentName;
    write[index.guideAmount] = guideAmount;
    write[index.unpaidStatus] = unpaidStatus;
    write[index.lastContactAt] = lastContactAt;
    write[index.lastContactMemo] = lastContactMemo;
    write[index.contactCount] = contactCount;
    write[index.lastUpdatedAt] = nowIso;
    for (var c = 0; c < sheet.getLastColumn(); c++) {
      if (typeof write[c] === "undefined") write[c] = "";
    }
    sheet.getRange(rowNo, 1, 1, sheet.getLastColumn()).setValues([write]);
    return { success: true, status: unpaidStatus };
  } catch (e) {
    return { success: false, message: "상태 저장 오류: " + e.message };
  }
}

function appendTuitionPaymentEntry(payload) {
  try {
    var req = payload || {};
    var monthName = String(req.monthName || "").trim();
    if (!monthName) return { success: false, message: "월 정보가 없습니다." };
    var studentName = normalizeTuitionStudentName_(req.studentName);
    if (!studentName) return { success: false, message: "학생명이 없습니다." };
    var amount = Math.round(toPayrollNumber_(req.amount));
    if (!amount) return { success: false, message: "금액이 0원일 수 없습니다." };

    var dueDate = String(req.dueDate || "").trim();
    var paidAt = String(req.paidAt || "").trim();
    var business = String(req.business || "").trim();
    var paymentType = String(req.paymentType || "").trim();
    var approvalNo = String(req.approvalNo || "").trim();
    var issueMemo = String(req.issueMemo || "").trim();
    var itemName = String(req.itemName || "납부금액").trim();
    var nowText = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d HH:mm");

    var ss = getPayrollSpreadsheet_();
    var sheet = ss.getSheetByName(monthName);
    if (!sheet) {
      sheet = ss.insertSheet(monthName);
      sheet.getRange(1, 1, 1, 10).setValues([["납입기한", "이름", "항목", "금액", "납부", "사업자", "결재구분", "승인번호", "입력일시", "이슈메모"]]);
    }
    ensureTuitionPaymentMemoColumn_(sheet);

    sheet.appendRow([
      dueDate,
      studentName,
      itemName || "납부금액",
      amount,
      paidAt,
      business,
      paymentType,
      approvalNo,
      nowText,
      issueMemo
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, message: "수납 입력 오류: " + e.message };
  }
}

function getTuitionMonthlySalesOverview(payload) {
  try {
    var months = getTuitionMonthSheetNames_();
    if (!months.length) return { success: false, message: "수강료 월 탭이 없습니다." };
    var ss = getPayrollSpreadsheet_();
    var dueMap = {};
    var paidMap = {};

    months.forEach(function(monthName) {
      var sheet = ss.getSheetByName(monthName);
      if (!sheet) return;
      var rows = parseTuitionRows_(sheet);
      rows.forEach(function(row) {
        var delta = 0 - toPayrollNumber_(row.amount);
        if (!delta) return;
        var dueKey = parseTuitionDueMonthKey_(row.dueDate, monthName);
        var paidKey = parseTuitionPaidMonthKey_(row.paidAt, monthName);
        if (dueKey) dueMap[dueKey] = (dueMap[dueKey] || 0) + delta;
        if (paidKey) paidMap[paidKey] = (paidMap[paidKey] || 0) + delta;
      });
    });

    var keySet = {};
    Object.keys(dueMap).forEach(function(k) { keySet[k] = true; });
    Object.keys(paidMap).forEach(function(k) { keySet[k] = true; });

    var labels = Object.keys(keySet).sort(function(a, b) {
      var pa = parseTuitionYearMonthKey_(a);
      var pb = parseTuitionYearMonthKey_(b);
      if (pa.year !== pb.year) return pa.year - pb.year;
      return pa.month - pb.month;
    });

    return {
      success: true,
      labels: labels,
      dueTotals: labels.map(function(k) { return Math.round(dueMap[k] || 0); }),
      paidTotals: labels.map(function(k) { return Math.round(paidMap[k] || 0); })
    };
  } catch (e) {
    return { success: false, message: "월별 매출 집계 오류: " + e.message };
  }
}

function getTuitionStudentMonthlyHistory(payload) {
  try {
    var req = payload || {};
    var studentName = normalizeTuitionStudentName_(req.studentName);
    if (!studentName) return { success: false, message: "학생명이 없습니다." };
    var months = getTuitionMonthSheetNames_();
    if (!months.length) return { success: true, studentName: studentName, rows: [] };

    var ss = getPayrollSpreadsheet_();
    var paymentByMonth = {};
    months.forEach(function(srcMonth) {
      var sheet = ss.getSheetByName(srcMonth);
      if (!sheet) return;
      parseTuitionRows_(sheet).forEach(function(row) {
        if (normalizeTuitionStudentName_(row.studentName) !== studentName) return;
        var dueMonth = parseTuitionDueMonthName_(row.dueDate);
        if (!dueMonth) return;
        if (!paymentByMonth[dueMonth]) {
          paymentByMonth[dueMonth] = {
            collectedAmount: 0,
            paidDates: {},
            routes: {}
          };
        }
        var bucket = paymentByMonth[dueMonth];
        bucket.collectedAmount += (0 - toPayrollNumber_(row.amount));
        if (row.paidAt) bucket.paidDates[String(row.paidAt)] = true;
        var route = normalizeTuitionRouteLabel_(row.paymentType, row.issueMemo);
        bucket.routes[route] = true;
      });
    });

    var followup = loadTuitionStudentFollowupByMonth_(studentName);
    var rows = months.map(function(monthName) {
      var paidInfo = paymentByMonth[monthName] || { collectedAmount: 0, paidDates: {}, routes: {} };
      var followInfo = followup[monthName] || {};
      var guideAmount = Math.max(0, Math.round(toPayrollNumber_(followInfo.guideAmount)));
      var collectedAmount = Math.round(paidInfo.collectedAmount || 0);
      var outstandingAmount = Math.max(0, guideAmount - Math.max(0, collectedAmount));
      var paidDates = Object.keys(paidInfo.paidDates || {}).sort(function(a, b) { return String(a).localeCompare(String(b)); });
      var routes = Object.keys(paidInfo.routes || {});
      var unpaidStatus = normalizeTuitionUnpaidStatus_(followInfo.unpaidStatus || "");
      var paid = collectedAmount > 0 || unpaidStatus === "납부완료" || unpaidStatus === "이월금";
      if (paid && unpaidStatus !== "이월금") unpaidStatus = "납부완료";
      return {
        monthName: monthName,
        guideAmount: guideAmount,
        collectedAmount: collectedAmount,
        outstandingAmount: outstandingAmount,
        paid: paid,
        unpaidStatus: unpaidStatus,
        paidDates: paidDates,
        paymentRoutes: routes
      };
    }).sort(function(a, b) {
      var ma = parseTuitionMonthName_(a.monthName);
      var mb = parseTuitionMonthName_(b.monthName);
      if (!ma || !mb) return String(b.monthName).localeCompare(String(a.monthName));
      if (ma.year !== mb.year) return mb.year - ma.year;
      return mb.month - ma.month;
    });

    return { success: true, studentName: studentName, rows: rows };
  } catch (e) {
    return { success: false, message: "학생 월별 이력 조회 오류: " + e.message };
  }
}

function loadTuitionStudentFollowupByMonth_(studentName) {
  var map = {};
  var ss = getPayrollSpreadsheet_();
  var sheet = ss.getSheetByName(TUITION_FOLLOWUP_SHEET_NAME);
  if (!sheet) return map;
  var values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return map;
  var headers = values[0] || [];
  var index = buildTuitionHeaderIndex_(headers, {
    monthName: ["월"],
    studentName: ["학생명"],
    guideAmount: ["안내금액"],
    unpaidStatus: ["미납상태"]
  });
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var monthName = String(row[index.monthName] || "").trim();
    var name = normalizeTuitionStudentName_(row[index.studentName]);
    if (!monthName || !name || name !== studentName) continue;
    map[monthName] = {
      guideAmount: toPayrollNumber_(row[index.guideAmount]),
      unpaidStatus: String(row[index.unpaidStatus] || "").trim()
    };
  }
  return map;
}

function parseTuitionYearMonthKey_(key) {
  var text = String(key || "").trim();
  var m = text.match(/^(\d{2})-(\d{2})$/);
  if (!m) return { year: 0, month: 0 };
  return { year: 2000 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

function parseTuitionDueMonthKey_(dueDateText, fallbackMonthName) {
  var text = String(dueDateText || "").trim();
  if (text) {
    var m4 = text.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*\d{1,2}/);
    if (m4) return String(m4[1]).slice(2) + "-" + payrollPad2_(parseInt(m4[2], 10));
    var m2 = text.match(/(^|[^0-9])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*\d{1,2}([^0-9]|$)/);
    if (m2) return m2[2] + "-" + payrollPad2_(parseInt(m2[3], 10));
  }
  var fallback = String(fallbackMonthName || "").replace(/s$/i, "").trim();
  return /^\d{2}-\d{2}$/.test(fallback) ? fallback : "";
}

function parseTuitionPaidMonthKey_(paidAtText, baseMonthName) {
  var text = String(paidAtText || "").trim();
  var base = parseTuitionMonthName_(baseMonthName);
  if (!base) return "";
  var year = base.year;
  var month = base.month;

  if (text) {
    var f4 = text.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*\d{1,2}/);
    if (f4) {
      year = parseInt(f4[1], 10);
      month = parseInt(f4[2], 10);
      return String(year).slice(2) + "-" + payrollPad2_(month);
    }
    var f2 = text.match(/(^|[^0-9])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*\d{1,2}([^0-9]|$)/);
    if (f2) {
      year = 2000 + parseInt(f2[2], 10);
      month = parseInt(f2[3], 10);
      return String(year).slice(2) + "-" + payrollPad2_(month);
    }
    var md = text.match(/(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
    if (md) {
      month = parseInt(md[1], 10);
      if (base.month === 1 && month === 12) year -= 1;
      if (base.month === 12 && month === 1) year += 1;
      return String(year).slice(2) + "-" + payrollPad2_(month);
    }
  }
  return String(year).slice(2) + "-" + payrollPad2_(month);
}

function payrollPad2_(num) {
  var n = parseInt(num, 10);
  if (isNaN(n)) n = 0;
  return n < 10 ? ("0" + n) : String(n);
}

function getPayrollMonthSummary(payload) {
  try {
    var req = payload || {};
    var monthSheets = getPayrollMonthSheetNames_();
    if (!monthSheets.length) {
      return { success: false, message: "급여 정산 월 탭(예: 26-02)을 찾을 수 없습니다." };
    }

    var monthName = String(req.monthName || monthSheets[0]).trim();
    var monthMeta = parsePayrollMonthName_(monthName);
    if (!monthMeta) {
      return { success: false, message: "월 탭 이름 형식이 올바르지 않습니다: " + monthName };
    }

    var sheet = getPayrollSpreadsheet_().getSheetByName(monthName);
    if (!sheet) {
      return { success: false, message: "선택한 월 탭을 찾을 수 없습니다: " + monthName };
    }

    var rows = parsePayrollRows_(sheet, monthMeta);
    var teacherBundle = buildPayrollTeacherOptions_(rows);
    var options = {
      subjectFilter: String(req.subjectFilter || "").trim(),
      teacherName: String(req.teacherName || "").trim(),
      classTypeFilter: String(req.classTypeFilter || "").trim(),
      salaryMode: normalizePayrollSalaryMode_(req.salaryMode),
      ratioPercent: clampPayrollNumber_(toPayrollNumber_(req.ratioPercent), 0, 100, 50),
      hourlyRate: Math.max(0, toPayrollNumber_(req.hourlyRate)),
      freeIncludedRowKeySet: toPayrollKeySet_(req.freeIncludedRowKeys),
      recognitionOverrideMap: toPayrollRecognitionOverrideMap_(req.recognitionOverrides),
      rateAdjustmentMap: toPayrollRateAdjustmentMap_(req.rateAdjustments)
    };
    options.teacherSettings = loadPayrollTeacherSettings_();
    options.teacherSettingsSignature = buildPayrollTeacherSettingsSignature_(options.teacherSettings, options.teacherName);
    var sheetVersion = getPayrollSheetVersion_(sheet);
    var cacheKey = buildPayrollSummaryCacheKey_(monthName, sheetVersion, req, options);
    var cachePath = "payroll/months/" + monthName + "/summary_cache/" + cacheKey;
    var cachedSummary = null;
    var cacheError = "";

    try {
      var cached = firebaseRequestWithServiceAccount_("get", cachePath);
      if (cached && cached.payload) cachedSummary = cached.payload;
    } catch (cacheReadErr) {
      cacheError = "read:" + cacheReadErr.message;
    }

    var summary;
    var cachedValid = cachedSummary && isPayrollSummaryCacheValidForOptions_(cachedSummary, options);
    if (cachedValid) {
      summary = cachedSummary;
      summary.cache = {
        source: "firebase",
        hit: true,
        key: cacheKey,
        sheetVersion: sheetVersion
      };
    } else {
      summary = buildPayrollSummary_(rows, monthMeta, options);
      summary.cache = {
        source: "firebase",
        hit: false,
        key: cacheKey,
        sheetVersion: sheetVersion,
        error: cacheError,
        invalidated: !!cachedSummary
      };
      try {
        firebaseRequestWithServiceAccount_("put", cachePath, {
          storedAt: new Date().toISOString(),
          monthName: monthName,
          sheetVersion: sheetVersion,
          payload: summary
        });
      } catch (cacheWriteErr) {
        summary.cache.error = summary.cache.error
          ? summary.cache.error + " / write:" + cacheWriteErr.message
          : "write:" + cacheWriteErr.message;
      }
    }

    summary.success = true;
    summary.selectedMonth = monthName;
    summary.monthLabel = monthMeta.year + "년 " + monthMeta.month + "월";
    summary.salaryMode = options.salaryMode;
    summary.ratioPercent = options.ratioPercent;
    summary.hourlyRate = options.hourlyRate;
    summary.subjects = teacherBundle.subjects;
    summary.teachers = teacherBundle.teachers;
    summary.teacherGroups = teacherBundle.groups;
    summary.months = monthSheets;
    return summary;
  } catch (e) {
    return { success: false, message: "정산 데이터 계산 오류: " + e.message };
  }
}

function getPayrollSheetVersion_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var tailA = "";
  var tailB = "";
  if (lastRow > 0) {
    tailA = String(sheet.getRange(lastRow, 1).getDisplayValue() || "");
    tailB = String(sheet.getRange(lastRow, Math.max(1, lastCol)).getDisplayValue() || "");
  }
  return [lastRow, lastCol, tailA, tailB].join("_");
}

function buildPayrollSummaryCacheKey_(monthName, sheetVersion, req, options) {
  var freeRows = (Array.isArray(req.freeIncludedRowKeys) ? req.freeIncludedRowKeys : [])
    .map(function(v) { return String(v || "").trim(); })
    .filter(function(v) { return !!v; })
    .sort();
  var overrides = (Array.isArray(req.recognitionOverrides) ? req.recognitionOverrides : [])
    .map(function(item) {
      return {
        rowKey: String((item && item.rowKey) || "").trim(),
        recognized: !!(item && item.recognized)
      };
    })
    .filter(function(item) { return !!item.rowKey; })
    .sort(function(a, b) { return a.rowKey < b.rowKey ? -1 : (a.rowKey > b.rowKey ? 1 : 0); });
  var rateAdjustments = (Array.isArray(req.rateAdjustments) ? req.rateAdjustments : [])
    .map(function(item) {
      return {
        rowKey: String((item && item.rowKey) || "").trim(),
        rate: roundPayrollNumber_(toPayrollNumber_(item && item.rate), 2)
      };
    })
    .filter(function(item) { return !!item.rowKey && item.rate > 0; })
    .sort(function(a, b) { return a.rowKey < b.rowKey ? -1 : (a.rowKey > b.rowKey ? 1 : 0); });

  var signature = {
    cacheSchemaVersion: PAYROLL_CACHE_SCHEMA_VERSION,
    monthName: monthName,
    sheetVersion: sheetVersion,
    subjectFilter: options.subjectFilter,
    teacherName: options.teacherName,
    classTypeFilter: options.classTypeFilter,
    salaryMode: options.salaryMode,
    ratioPercent: options.ratioPercent,
    hourlyRate: options.hourlyRate,
    teacherSettingsSignature: options.teacherSettingsSignature || "",
    freeIncludedRowKeys: freeRows,
    recognitionOverrides: overrides,
    rateAdjustments: rateAdjustments
  };
  var text = JSON.stringify(signature);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytesToHex_(digest);
}

function isPayrollSummaryCacheValidForOptions_(summary, options) {
  if (!summary || !Array.isArray(summary.rows)) return false;
  var teacher = String(options.teacherName || "").trim();
  var subject = String(options.subjectFilter || "").trim();
  var classType = String(options.classTypeFilter || "").trim();
  for (var i = 0; i < summary.rows.length; i++) {
    var row = summary.rows[i] || {};
    if (teacher && String(row.teacher || "").trim() !== teacher) return false;
    if (subject && String(row.subject || "").trim() !== subject) return false;
    if (classType && String(row.classType || "").trim() !== classType) return false;
  }
  return true;
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) {
    var v = b;
    if (v < 0) v += 256;
    var s = v.toString(16);
    return s.length === 1 ? "0" + s : s;
  }).join("");
}

function buildPayrollTeacherSettingsSignature_(settings, teacherName) {
  var source = settings && typeof settings === "object" ? settings : {};
  var payload = {};
  if (teacherName) {
    var cfg = source[teacherName] || {};
    payload[teacherName] = {
      salaryMode: normalizePayrollSalaryMode_(cfg.salaryMode),
      hourlyRate: Math.max(0, toPayrollNumber_(cfg.hourlyRate)),
      oneToOneSettlementMode: String(cfg.oneToOneSettlementMode || "").toLowerCase() === "ratio" ? "ratio" : "hourly",
      oneToOneRatioPercent: clampPayrollNumber_(toPayrollNumber_(cfg.oneToOneRatioPercent), 0, 100, 50)
    };
  } else {
    var keys = Object.keys(source).sort();
    keys.forEach(function(name) {
      var cfg = source[name] || {};
      payload[name] = {
        salaryMode: normalizePayrollSalaryMode_(cfg.salaryMode),
        hourlyRate: Math.max(0, toPayrollNumber_(cfg.hourlyRate)),
        oneToOneSettlementMode: String(cfg.oneToOneSettlementMode || "").toLowerCase() === "ratio" ? "ratio" : "hourly",
        oneToOneRatioPercent: clampPayrollNumber_(toPayrollNumber_(cfg.oneToOneRatioPercent), 0, 100, 50)
      };
    });
  }
  return JSON.stringify(payload);
}

function getPayrollSpreadsheet_() {
  return SpreadsheetApp.openById(PAYROLL_SS_ID);
}

function getPayrollMonthSheetNames_() {
  var ss = getPayrollSpreadsheet_();
  var names = ss.getSheets().map(function(sheet) { return sheet.getName(); });
  var valid = names.filter(function(name) { return !!parsePayrollMonthName_(name); });
  valid.sort(function(a, b) {
    var ma = parsePayrollMonthName_(a);
    var mb = parsePayrollMonthName_(b);
    if (ma.year !== mb.year) return mb.year - ma.year;
    return mb.month - ma.month;
  });
  return valid;
}

function getTuitionMonthSheetNames_() {
  var ss = getPayrollSpreadsheet_();
  var names = ss.getSheets().map(function(sheet) { return sheet.getName(); });
  var valid = names.filter(function(name) {
    return /^\d{2}-\d{2}s$/i.test(String(name || "").trim());
  });
  valid.sort(function(a, b) {
    var ma = parseTuitionMonthName_(a);
    var mb = parseTuitionMonthName_(b);
    if (!ma || !mb) return String(b).localeCompare(String(a));
    if (ma.year !== mb.year) return mb.year - ma.year;
    return mb.month - ma.month;
  });
  return valid;
}

function parseTuitionMonthName_(name) {
  var text = String(name || "").trim();
  var m = text.match(/^(\d{2})-(\d{2})s$/i);
  if (!m) return null;
  var yy = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  if (isNaN(yy) || isNaN(mm) || mm < 1 || mm > 12) return null;
  return { year: 2000 + yy, month: mm };
}

function parseTuitionRows_(sheet) {
  var values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return [];
  var headers = values[0] || [];
  var index = buildTuitionHeaderIndex_(headers, {
    dueDate: ["납입기한"],
    studentName: ["이름"],
    itemName: ["항목"],
    amount: ["금액"],
    paidAt: ["납부"],
    business: ["사업자"],
    paymentType: ["결재구분", "결제구분"],
    approvalNo: ["승인번호"],
    inputAt: ["입력일시"],
    issueMemo: ["이슈메모", "메모", "비고", "column10", "column1"]
  });
  var issueMemoIndex = index.issueMemo;
  if (issueMemoIndex === 0) {
    var h0 = normalizeTuitionHeaderText_(headers[0]);
    var isMemoHeader = h0.indexOf("이슈메모") !== -1 || h0.indexOf("메모") !== -1 || h0.indexOf("비고") !== -1 || h0.indexOf("column10") !== -1 || h0.indexOf("column1") !== -1;
    if (!isMemoHeader) {
      issueMemoIndex = headers.length >= 10 ? 9 : -1;
    }
  }

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var studentName = normalizeTuitionStudentName_(row[index.studentName]);
    if (!studentName) continue;
    var amount = toPayrollNumber_(row[index.amount]);
    var paidAt = String(row[index.paidAt] || "").trim();
    var business = String(row[index.business] || "").trim();
    var paymentType = String(row[index.paymentType] || "").trim();
    var approvalNo = String(row[index.approvalNo] || "").trim();
    var inputAt = String(row[index.inputAt] || "").trim();
    var issueMemo = issueMemoIndex >= 0 ? String(row[issueMemoIndex] || "").trim() : "";
    var hasPaymentSignal = amount !== 0 || !!paidAt || !!paymentType || !!approvalNo || !!inputAt || !!business || !!issueMemo;
    if (!hasPaymentSignal) continue;

    rows.push({
      rowNumber: i + 1,
      dueDate: String(row[index.dueDate] || "").trim(),
      studentName: studentName,
      itemName: String(row[index.itemName] || "").trim(),
      amount: amount,
      paidAt: paidAt,
      business: business,
      paymentType: paymentType,
      approvalNo: approvalNo,
      inputAt: inputAt,
      issueMemo: issueMemo
    });
  }
  return rows;
}

function normalizeTuitionRouteLabel_(paymentType, issueMemo) {
  var raw = String(paymentType || "").toLowerCase();
  if (!raw) return "기타";
  if (/서울페이|서초페이|제로페이/.test(raw)) return "서울페이";
  if (/현장|방문|카운터|pos/.test(raw)) return "현장결제";
  if (/계좌|이체|입금|송금|무통장/.test(raw)) return "계좌";
  if (/현금/.test(raw)) return "현금";
  if (/카드|신한|국민|삼성|농협|현대|하나|롯데/.test(raw)) return "카드";
  return "기타";
}

function parseTuitionDueMonthName_(dueDateText) {
  var text = String(dueDateText || "").trim();
  if (!text) return "";
  var m = text.match(/(\d{2})\s*[-./]\s*(\d{2})\s*[-./]\s*\d{1,2}/);
  if (!m) m = text.match(/(\d{2})\s*년\s*(\d{1,2})\s*월/);
  if (!m) m = text.match(/\b(\d{2})(\d{2})\d{2}\b/);
  if (!m) return "";
  var yy = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  if (isNaN(yy) || isNaN(mm) || mm < 1 || mm > 12) return "";
  return ("0" + yy).slice(-2) + "-" + ("0" + mm).slice(-2) + "s";
}

function extractTuitionMonthDay_(dateText) {
  var text = String(dateText || "").trim();
  if (!text) return "";
  var full = text.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  var fullShort = text.match(/(^|\D)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(\D|$)/);
  var md = text.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
  var month = 0;
  var day = 0;
  if (full) {
    month = parseInt(full[2], 10);
    day = parseInt(full[3], 10);
  } else if (fullShort) {
    month = parseInt(fullShort[3], 10);
    day = parseInt(fullShort[4], 10);
  } else if (md) {
    month = parseInt(md[1], 10);
    day = parseInt(md[2], 10);
  } else {
    return "";
  }
  if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return ("0" + month).slice(-2) + "-" + ("0" + day).slice(-2);
}

function loadTuitionClassStudentMapByMonth_(tuitionMonthName) {
  var classMonthName = String(tuitionMonthName || "").trim().replace(/s$/i, "");
  if (!/^\d{2}-\d{2}$/.test(classMonthName)) return null;
  var ss = getPayrollSpreadsheet_();
  var sheet = ss.getSheetByName(classMonthName);
  if (!sheet) return null;

  var values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return {};
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var name = normalizeTuitionStudentName_(row[0]);
    if (!name) continue;
    map[name] = true;
  }
  return map;
}

function ensureTuitionPaymentMemoColumn_(sheet) {
  if (!sheet) return;
  var targetCol = 10;
  if (sheet.getMaxColumns() < targetCol) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), targetCol - sheet.getMaxColumns());
  }
  var header = String(sheet.getRange(1, targetCol).getDisplayValue() || "").trim();
  if (!header) {
    sheet.getRange(1, targetCol).setValue("이슈메모");
  }
}

function buildTuitionHeaderIndex_(headers, spec) {
  var normalized = (headers || []).map(function(h) {
    return normalizeTuitionHeaderText_(h);
  });
  var index = {};
  Object.keys(spec).forEach(function(key) {
    index[key] = -1;
    var candidates = spec[key] || [];
    for (var i = 0; i < normalized.length; i++) {
      for (var j = 0; j < candidates.length; j++) {
        var token = normalizeTuitionHeaderText_(candidates[j]);
        if (token && normalized[i].indexOf(token) !== -1) {
          index[key] = i;
          break;
        }
      }
      if (index[key] !== -1) break;
    }
    if (index[key] === -1) index[key] = 0;
  });
  return index;
}

function normalizeTuitionHeaderText_(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[^\u3131-\uD79D0-9A-Za-z]/g, "")
    .toLowerCase();
}

function loadTuitionStudentMaster_() {
  var ss = SpreadsheetApp.openById(TEACHER_SS_ID);
  var sheet = ss.getSheetByName("student");
  if (!sheet) return [];
  var range = sheet.getDataRange();
  var values = range.getValues();
  var displayValues = range.getDisplayValues();
  var validations = range.getDataValidations();
  if (!values || values.length < 2) return [];

  var headers = values[0] || [];
  var normalizedHeaders = headers.map(function(h) {
    return normalizeTuitionHeaderText_(h);
  });
  var nameCol = findTuitionStudentColIndex_(normalizedHeaders, ["이름필드", "이름", "학생명"], 0);
  var schoolCol = findTuitionStudentColIndex_(normalizedHeaders, ["학교필드", "학교"], 1);
  var gradeCol = findTuitionStudentColIndex_(normalizedHeaders, ["학년필드", "학년"], 2);
  var activeCol = findTuitionStudentColIndex_(normalizedHeaders, ["등록상태", "등록여부", "재원상태"], -1);

  var rows = [];
  for (var i = 1; i < displayValues.length; i++) {
    var row = values[i] || [];
    var displayRow = displayValues[i] || [];
    var rawName = String(displayRow[nameCol] || "").trim();
    if (!rawName) continue;
    if (activeCol >= 0) {
      var activeValue = row[activeCol];
      var activeDisplayValue = displayRow[activeCol];
      var activeValidation = (validations[i] && validations[i][activeCol]) || null;
      if (!isTuitionStudentRegistered_(activeValue, activeDisplayValue, activeValidation)) continue;
    }
    rows.push({
      name: normalizeTuitionStudentName_(rawName),
      school: String(displayRow[schoolCol] || "").trim(),
      grade: String(displayRow[gradeCol] || "").trim()
    });
  }
  return rows;
}

function findTuitionStudentColIndex_(normalizedHeaders, tokens, fallback) {
  for (var i = 0; i < normalizedHeaders.length; i++) {
    var header = normalizedHeaders[i] || "";
    for (var j = 0; j < tokens.length; j++) {
      var token = normalizeTuitionHeaderText_(tokens[j]);
      if (token && header.indexOf(token) !== -1) return i;
    }
  }
  return fallback;
}

function isTuitionStudentRegistered_(rawValue, displayValue, validation) {
  if (
    validation &&
    validation.getCriteriaType &&
    validation.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX
  ) {
    // 체크박스는 "true"만 유효 학생으로 인정 (사용자 지정 체크값도 지원)
    var checkboxArgs = validation.getCriteriaValues() || [];
    if (checkboxArgs.length >= 2) {
      var checkedValue = checkboxArgs[0];
      var uncheckedValue = checkboxArgs[1];
      if (checkedValue !== null && checkedValue !== undefined && String(checkedValue) !== "") {
        return String(rawValue) === String(checkedValue);
      }
      if (uncheckedValue !== null && uncheckedValue !== undefined && String(rawValue) === String(uncheckedValue)) {
        return false;
      }
    }
    return rawValue === true || String(rawValue || "").trim().toLowerCase() === "true";
  }

  if (typeof rawValue === "boolean") return rawValue;
  if (typeof rawValue === "number") return rawValue === 1;
  var text = String(rawValue === null || rawValue === undefined || rawValue === "" ? (displayValue || "") : rawValue)
    .trim()
    .toLowerCase();
  if (!text) return false;
  if (text === "true" || text === "1" || text === "y" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "n" || text === "no") return false;
  return /^(등록|재원|활성|사용|체크|checked|v|o|✓|✔|☑|✅)$/i.test(String(text));
}

function normalizeTuitionStudentName_(name) {
  return String(name || "").replace(/^\//, "").trim();
}

function normalizeTuitionUnpaidStatus_(status) {
  var text = String(status || "").trim();
  var allow = {
    "납부완료": true,
    "이월금": true,
    "안내이전": true,
    "안내완료": true,
    "연락두절": true,
    "확인필요": true,
    "납부예정": true
  };
  return allow[text] ? text : "안내이전";
}

function buildTuitionSummaryStats_(rows, paymentRows) {
  var kpi = {
    totalStudents: rows.length,
    paidStudents: 0,
    unpaidStudents: 0,
    expectedAmount: 0,
    collectedAmount: 0,
    outstandingAmount: 0
  };
  var statusMap = {
    "납부완료": 0,
    "이월금": 0,
    "안내이전": 0,
    "안내완료": 0,
    "연락두절": 0,
    "확인필요": 0,
    "납부예정": 0
  };

  rows.forEach(function(row) {
    kpi.expectedAmount += Math.max(0, toPayrollNumber_(row.guideAmount));
    kpi.collectedAmount += Math.max(0, toPayrollNumber_(row.collectedAmount));
    kpi.outstandingAmount += Math.max(0, toPayrollNumber_(row.outstandingAmount));
    if (row.unpaidStatus === "납부완료" || row.unpaidStatus === "이월금") kpi.paidStudents += 1;
    else kpi.unpaidStudents += 1;
    if (!statusMap[row.unpaidStatus]) statusMap[row.unpaidStatus] = 0;
    statusMap[row.unpaidStatus] += 1;
  });
  kpi.expectedAmount = Math.round(kpi.expectedAmount);
  kpi.collectedAmount = Math.round(kpi.collectedAmount);
  kpi.outstandingAmount = Math.round(kpi.outstandingAmount);

  var chartLabels = Object.keys(statusMap);
  var chartValues = chartLabels.map(function(label) { return statusMap[label] || 0; });

  var payments = (paymentRows || []).slice().sort(function(a, b) {
    var ad = String(a.inputAt || a.paidAt || "");
    var bd = String(b.inputAt || b.paidAt || "");
    if (ad === bd) return b.rowNumber - a.rowNumber;
    return bd.localeCompare(ad);
  });

  return {
    kpi: kpi,
    chart: {
      labels: chartLabels,
      values: chartValues
    },
    allPayments: (paymentRows || []).slice(),
    payments: payments
  };
}

function ensureTuitionFollowupSheet_(ss) {
  var sheet = ss.getSheetByName(TUITION_FOLLOWUP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TUITION_FOLLOWUP_SHEET_NAME);
    sheet.getRange(1, 1, 1, 8).setValues([[
      "월",
      "학생명",
      "안내금액",
      "미납상태",
      "마지막연락일시",
      "마지막연락메모",
      "연락횟수",
      "마지막수정일시"
    ]]);
  }
  return sheet;
}

function ensureTuitionContactLogSheet_(ss) {
  var sheet = ss.getSheetByName(TUITION_CONTACT_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TUITION_CONTACT_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 6).setValues([[
      "월",
      "학생명",
      "안내금액",
      "미납상태",
      "메모",
      "기록일시"
    ]]);
  }
  return sheet;
}

function loadTuitionFollowupMap_(monthName) {
  var ss = getPayrollSpreadsheet_();
  var sheet = ss.getSheetByName(TUITION_FOLLOWUP_SHEET_NAME);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getDataRange().getDisplayValues();
  var headers = values[0] || [];
  var index = buildTuitionHeaderIndex_(headers, {
    monthName: ["월"],
    studentName: ["학생명"],
    guideAmount: ["안내금액"],
    unpaidStatus: ["미납상태"],
    lastContactAt: ["마지막연락일시"],
    lastContactMemo: ["마지막연락메모"],
    contactCount: ["연락횟수"],
    lastUpdatedAt: ["마지막수정일시"]
  });
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(row[index.monthName] || "").trim() !== monthName) continue;
    var name = normalizeTuitionStudentName_(row[index.studentName]);
    if (!name) continue;
    map[name] = {
      guideAmount: toPayrollNumber_(row[index.guideAmount]),
      unpaidStatus: normalizeTuitionUnpaidStatus_(row[index.unpaidStatus]),
      lastContactAt: String(row[index.lastContactAt] || ""),
      lastContactMemo: String(row[index.lastContactMemo] || ""),
      contactCount: parseInt(row[index.contactCount] || "0", 10) || 0,
      lastUpdatedAt: String(row[index.lastUpdatedAt] || "")
    };
  }
  return map;
}

function parsePayrollMonthName_(name) {
  var text = String(name || "").trim();
  var m = text.match(/^(\d{2}|\d{4})-(\d{2})$/);
  if (!m) return null;
  var yearNum = parseInt(m[1], 10);
  var monthNum = parseInt(m[2], 10);
  if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) return null;
  if (m[1].length === 2) yearNum += 2000;
  return {
    sheetName: text,
    year: yearNum,
    month: monthNum,
    daysInMonth: new Date(yearNum, monthNum, 0).getDate()
  };
}

function parsePayrollRows_(sheet, monthMeta) {
  var values = sheet.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return [];

  var headers = values[0].map(function(h) { return normalizePayrollHeader_(h); });
  var indexMap = getPayrollColumnIndexMap_(headers);
  var rows = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var teacherName = String(row[indexMap.tr] || "").trim();
    var studentName = normalizePayrollStudentName_(row[indexMap.name]);
    var className = String(row[indexMap.className] || "").trim();
    if (!teacherName && !studentName && !className) continue;

    var dateInfo = parsePayrollDateCell_(row[indexMap.classDate], monthMeta);
    var startText = String(row[indexMap.start] || "").trim();
    var endText = String(row[indexMap.end] || "").trim();
    var startMinutes = parsePayrollTimeMinutes_(startText);
    var endMinutes = parsePayrollTimeMinutes_(endText);
    var hours = toPayrollNumber_(row[indexMap.hours]);
    if (hours <= 0) {
      hours = computePayrollHourDiff_(startText, endText);
    }
    var classType = detectPayrollClassType_(className);
    var schoolType = detectPayrollSchoolType_(className);
    var gradeBand = detectPayrollGradeBand_(className);
    var subject = detectPayrollSubject_(className);
    var rateSignature = [subject, schoolType, gradeBand, classType].join("|");

    rows.push({
      rowNumber: r + 1,
      rowKey: monthMeta.sheetName + ":" + (r + 1),
      name: studentName,
      classDateRaw: String(row[indexMap.classDate] || "").trim(),
      classDateKey: dateInfo.dateKey,
      classDateLabel: dateInfo.label,
      day: dateInfo.day,
      className: className,
      attendance: String(row[indexMap.attendance] || "").trim(),
      attendanceCode: normalizePayrollAttendanceCode_(row[indexMap.attendance]),
      room: String(row[indexMap.room] || "").trim(),
      teacher: teacherName,
      start: startText,
      end: endText,
      startMinutes: startMinutes,
      endMinutes: endMinutes,
      hours: hours,
      rate: toPayrollNumber_(row[indexMap.hourlyRate]),
      amount: toPayrollNumber_(row[indexMap.amount]),
      note: String(row[indexMap.note] || "").trim(),
      discount: toPayrollNumber_(row[indexMap.discount]),
      classType: classType,
      schoolType: schoolType,
      gradeBand: gradeBand,
      subject: subject,
      rateSignature: rateSignature
    });
  }

  rows.sort(function(a, b) {
    if (a.classDateKey !== b.classDateKey) return a.classDateKey < b.classDateKey ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.rowNumber - b.rowNumber;
  });
  return rows;
}

function normalizePayrollStudentName_(value) {
  var text = String(value || "").trim();
  return text.replace(/^\/+/, "").trim();
}

function getPayrollColumnIndexMap_(headers) {
  return {
    name: findPayrollHeaderIndex_(headers, ["이름"], 0),
    classDate: findPayrollHeaderIndex_(headers, ["수업일"], 1),
    className: findPayrollHeaderIndex_(headers, ["반명"], 2),
    attendance: findPayrollHeaderIndex_(headers, ["출결"], 3),
    room: findPayrollHeaderIndex_(headers, ["관"], 4),
    tr: findPayrollHeaderIndex_(headers, ["tr"], 5),
    start: findPayrollHeaderIndex_(headers, ["시작"], 6),
    end: findPayrollHeaderIndex_(headers, ["종료"], 7),
    hours: findPayrollHeaderIndex_(headers, ["시간"], 8),
    hourlyRate: findPayrollHeaderIndex_(headers, ["시간당"], 9),
    amount: findPayrollHeaderIndex_(headers, ["금액"], 10),
    note: findPayrollHeaderIndex_(headers, ["참고"], 11),
    discount: findPayrollHeaderIndex_(headers, ["할인"], 12)
  };
}

function normalizePayrollHeader_(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

function findPayrollHeaderIndex_(headers, candidates, fallback) {
  for (var i = 0; i < candidates.length; i++) {
    var key = normalizePayrollHeader_(candidates[i]);
    var idx = headers.indexOf(key);
    if (idx !== -1) return idx;
  }
  return fallback;
}

function parsePayrollDateCell_(value, monthMeta) {
  var raw = String(value || "").trim();
  var month = monthMeta.month;
  var day = 1;
  var md = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (md) {
    month = parseInt(md[1], 10);
    day = parseInt(md[2], 10);
  } else {
    var dOnly = raw.match(/(\d{1,2})/);
    if (dOnly) day = parseInt(dOnly[1], 10);
  }
  if (isNaN(month) || month < 1 || month > 12) month = monthMeta.month;
  if (isNaN(day) || day < 1 || day > 31) day = 1;

  var dateObj = new Date(monthMeta.year, month - 1, day);
  if (dateObj.getMonth() + 1 !== month) {
    dateObj = new Date(monthMeta.year, monthMeta.month - 1, Math.min(day, monthMeta.daysInMonth));
  }

  var tz = Session.getScriptTimeZone() || "Asia/Seoul";
  return {
    dateKey: Utilities.formatDate(dateObj, tz, "yyyy-MM-dd"),
    label: (dateObj.getMonth() + 1) + "/" + dateObj.getDate(),
    day: dateObj.getDate(),
    month: dateObj.getMonth() + 1
  };
}

function detectPayrollClassType_(className) {
  var text = String(className || "").trim();
  if (!text) return "미분류";

  var ratioMatch = text.match(/\d+\s*:\s*\d+/);
  if (ratioMatch) return ratioMatch[0].replace(/\s+/g, "");
  if (/개별정규/.test(text)) return "개별정규";
  if (/개별/.test(text)) return "개별";
  if (/정규/.test(text)) return "정규";
  if (/특강/.test(text)) return "특강";
  if (/보강|보충/.test(text)) return "보강";
  return text.split("-")[0].trim();
}

function detectPayrollSubject_(className) {
  var text = String(className || "").replace(/\s+/g, "");
  if (/수학|math|미적|기하|확통|대수/i.test(text)) return "수학";
  if (/영어|eng|토플|텝스|toeic/i.test(text)) return "영어";
  if (/국어|kor|문학|독해|화작|언매/i.test(text)) return "국어";
  if (/과학|sci|물리|화학|생명|지구과학/i.test(text)) return "과학";
  if (/사회|사탐|역사|정치|경제|지리/i.test(text)) return "사회";
  if (/논술|에세이/i.test(text)) return "논술";
  return "기타";
}

function detectPayrollSchoolType_(className) {
  var text = String(className || "").replace(/\s+/g, "");
  if (/초등|초/i.test(text)) return "초등";
  if (/중등|중/i.test(text)) return "중등";
  if (/고등|고|n수|재수|반수/i.test(text)) return "고등/N수";
  return "미분류";
}

function detectPayrollGradeBand_(className) {
  var text = String(className || "");
  if (/재수|반수|n수|N수|N\d/.test(text)) return "N수";
  var g = text.match(/([1-6])\s*학년/);
  if (g) {
    var grade = parseInt(g[1], 10);
    if (grade <= 2) return "초등";
    if (grade <= 3) return "중등";
    return "고등";
  }
  var short = text.match(/-(\d)\s*h/i);
  if (short) {
    var n = parseInt(short[1], 10);
    if (n <= 2) return "중등";
    return "고등";
  }
  return "미분류";
}

function normalizePayrollAttendanceCode_(attendance) {
  var status = String(attendance || "").replace(/\s+/g, "");
  if (!status) return "기타";
  if (/출석/.test(status)) return "출석";
  if (/지각/.test(status)) return "지각";
  if (/당일취소|당취/.test(status)) return "당일취소";
  if (/결석예고/.test(status)) return "결석예고";
  if (/결석보강/.test(status)) return "결석보강";
  if (/보강|보충/.test(status)) return "보강";
  if (/프리/.test(status)) return "프리";
  if (/결석/.test(status)) return "결석";
  return status;
}

function normalizePayrollSalaryMode_(value) {
  return String(value || "").toLowerCase() === "hourly" ? "hourly" : "ratio";
}

function isPayrollOneToOneClassType_(classType) {
  var text = String(classType || "").replace(/\s+/g, "");
  return text === "1:1";
}

function resolvePayrollOneToOneRule_(teacherSettings, teacherName, defaultRatioPercent) {
  var settings = teacherSettings && typeof teacherSettings === "object" ? teacherSettings : {};
  var cfg = settings[String(teacherName || "").trim()] || {};
  var mode = String(cfg.oneToOneSettlementMode || "").toLowerCase() === "ratio" ? "ratio" : "hourly";
  var ratioPercent = clampPayrollNumber_(toPayrollNumber_(cfg.oneToOneRatioPercent), 0, 100, defaultRatioPercent || 50);
  return {
    useRatio: mode === "ratio",
    ratioPercent: ratioPercent
  };
}

function buildPayrollSummary_(rows, monthMeta, options) {
  var subjectFilter = String(options.subjectFilter || "").trim();
  var teacherName = options.teacherName;
  var classTypeFilter = String(options.classTypeFilter || "").trim();
  var filteredRows = rows.filter(function(row) {
    if (subjectFilter && row.subject !== subjectFilter) return false;
    if (classTypeFilter && row.classType !== classTypeFilter) return false;
    return !teacherName || row.teacher === teacherName;
  });
  var dayMap = {};
  var detailRows = [];
  var typeTotals = {};
  var typeFinanceMap = {};
  var attendanceTotals = {};
  var workingDayMap = {};
  var recognizedIntervalsByDay = {};
  var studentBaselineMap = buildPayrollStudentRateBaseline_(rows);
  var teacherSettings = options.teacherSettings || {};

  var totalRecognizedHours = 0;
  var totalRecognizedGross = 0;
  var totalRecognizedDiscount = 0;
  var totalRecognizedNet = 0;
  var totalCanceledAmount = 0;
  var recognizedLessonCount = 0;
  var totalOneToOneRatioSettlement = 0;
  var rateSuspicionMap = detectPayrollRateSuspicionMap_(rows);

  for (var i = 0; i < filteredRows.length; i++) {
    var row = filteredRows[i];
    var isFreeIncluded = !!options.freeIncludedRowKeySet[row.rowKey];
    var baseAttendanceInfo = evaluatePayrollAttendance_(row.attendance, isFreeIncluded);
    var overrideValue = options.recognitionOverrideMap[row.rowKey];
    var attendanceInfo = applyPayrollRecognitionOverride_(baseAttendanceInfo, overrideValue);
    var suggestedRate = resolvePayrollSuggestedRate_(row, studentBaselineMap);
    var isMakeupZeroEligible = isPayrollMakeupZeroAmountEligible_(row);
    var manualRate = options.rateAdjustmentMap[row.rowKey];
    var effectiveRate = row.rate;
    var effectiveAmount = row.amount;
    var rateAdjusted = false;

    if (attendanceInfo.recognized && isMakeupZeroEligible) {
      var chosenRate = (manualRate > 0) ? manualRate : (suggestedRate > 0 ? suggestedRate : row.rate);
      if (chosenRate > 0) {
        effectiveRate = chosenRate;
        effectiveAmount = Math.round(chosenRate * row.hours);
        rateAdjusted = Math.round(effectiveAmount) !== Math.round(row.amount);
      }
    } else if (manualRate > 0) {
      effectiveRate = manualRate;
      effectiveAmount = Math.round(manualRate * row.hours);
      rateAdjusted = true;
    }

    var netAmount = effectiveAmount - row.discount;
    var recognizedHours = attendanceInfo.recognized ? row.hours : 0;
    var recognizedGross = attendanceInfo.recognized ? effectiveAmount : 0;
    var recognizedDiscount = attendanceInfo.recognized ? row.discount : 0;
    var recognizedNet = attendanceInfo.recognized ? netAmount : 0;

    if (!dayMap[row.classDateKey]) {
      dayMap[row.classDateKey] = {
        dateKey: row.classDateKey,
        label: row.classDateLabel,
        day: row.day,
        lessonCount: 0,
        recognizedHours: 0,
        pureTeachingHours: 0,
        grossSales: 0,
        discount: 0,
        netSales: 0,
        settlementAmount: 0,
        oneToOneRatioSettlement: 0,
        canceledAmount: 0,
        classTypeMap: {},
        classTypeHourMap: {}
      };
    }
    attendanceTotals[row.attendanceCode] = (attendanceTotals[row.attendanceCode] || 0) + 1;
    if (row.attendanceCode === "당일취소") {
      dayMap[row.classDateKey].canceledAmount += Math.round(row.amount);
      totalCanceledAmount += Math.round(row.amount);
      if (!typeFinanceMap[row.classType]) {
        typeFinanceMap[row.classType] = { type: row.classType, count: 0, hours: 0, hourlyHoursEligible: 0, gross: 0, net: 0, settlement: 0, oneToOneRatioSettlement: 0, canceled: 0, canceledCount: 0 };
      }
      typeFinanceMap[row.classType].canceled += Math.round(row.amount);
      typeFinanceMap[row.classType].canceledCount += 1;
    }

    if (attendanceInfo.recognized) {
      dayMap[row.classDateKey].lessonCount += 1;
      dayMap[row.classDateKey].recognizedHours += recognizedHours;
      dayMap[row.classDateKey].grossSales += recognizedGross;
      dayMap[row.classDateKey].discount += recognizedDiscount;
      dayMap[row.classDateKey].netSales += recognizedNet;
      dayMap[row.classDateKey].classTypeHourMap[row.classType] = (dayMap[row.classDateKey].classTypeHourMap[row.classType] || 0) + recognizedHours;
      dayMap[row.classDateKey].classTypeMap[row.classType] = (dayMap[row.classDateKey].classTypeMap[row.classType] || 0) + 1;
      workingDayMap[row.classDateKey] = true;
      typeTotals[row.classType] = (typeTotals[row.classType] || 0) + 1;
      if (!typeFinanceMap[row.classType]) {
        typeFinanceMap[row.classType] = { type: row.classType, count: 0, hours: 0, hourlyHoursEligible: 0, gross: 0, net: 0, settlement: 0, oneToOneRatioSettlement: 0, canceled: 0, canceledCount: 0 };
      }
      typeFinanceMap[row.classType].count += 1;
      typeFinanceMap[row.classType].hours += recognizedHours;
      typeFinanceMap[row.classType].gross += recognizedGross;
      typeFinanceMap[row.classType].net += recognizedNet;
      recognizedLessonCount += 1;
      totalRecognizedHours += recognizedHours;
      totalRecognizedGross += recognizedGross;
      totalRecognizedDiscount += recognizedDiscount;
      totalRecognizedNet += recognizedNet;
      var oneToOneRule = resolvePayrollOneToOneRule_(teacherSettings, row.teacher, options.ratioPercent);
      var useOneToOneRatio = options.salaryMode === "hourly" && oneToOneRule.useRatio && isPayrollOneToOneClassType_(row.classType);
      var rowSettlement = 0;
      if (options.salaryMode === "hourly") {
        if (useOneToOneRatio) {
          rowSettlement = recognizedNet * (oneToOneRule.ratioPercent / 100);
          dayMap[row.classDateKey].oneToOneRatioSettlement += rowSettlement;
          typeFinanceMap[row.classType].oneToOneRatioSettlement += rowSettlement;
          totalOneToOneRatioSettlement += rowSettlement;
        } else {
          rowSettlement = 0; // 시급제는 일자 순수시수 기준으로 계산(아래 day settlement에서 처리)
          typeFinanceMap[row.classType].hourlyHoursEligible += recognizedHours;
        }
      } else {
        rowSettlement = recognizedNet * (options.ratioPercent / 100);
      }
      typeFinanceMap[row.classType].settlement += rowSettlement;
      if (!useOneToOneRatio && row.startMinutes !== null && row.endMinutes !== null && row.endMinutes > row.startMinutes) {
        if (!recognizedIntervalsByDay[row.classDateKey]) recognizedIntervalsByDay[row.classDateKey] = [];
        recognizedIntervalsByDay[row.classDateKey].push([row.startMinutes, row.endMinutes]);
      }
    }

    detailRows.push({
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      name: row.name,
      classDateLabel: row.classDateLabel,
      classDateKey: row.classDateKey,
      className: row.className,
      classType: row.classType,
      subject: row.subject,
      schoolType: row.schoolType,
      gradeBand: row.gradeBand,
      attendance: row.attendance,
      attendanceCode: row.attendanceCode,
      room: row.room,
      teacher: row.teacher,
      start: row.start,
      end: row.end,
      hours: row.hours,
      rate: effectiveRate,
      baseRate: row.rate,
      amount: Math.round(effectiveAmount),
      originalAmount: row.amount,
      discount: row.discount,
      netAmount: netAmount,
      note: row.note,
      isFreeEligible: attendanceInfo.freeEligible,
      freeIncluded: attendanceInfo.freeEligible && isFreeIncluded,
      baseRecognized: baseAttendanceInfo.recognized,
      recognized: attendanceInfo.recognized,
      isManuallyOverridden: typeof overrideValue === "boolean",
      recognitionLabel: attendanceInfo.label,
      recognizedHours: recognizedHours,
      recognizedNet: recognizedNet,
      oneToOneRatioRuleApplied: options.salaryMode === "hourly" && isPayrollOneToOneClassType_(row.classType)
        ? resolvePayrollOneToOneRule_(teacherSettings, row.teacher, options.ratioPercent).useRatio
        : false,
      suspectedRateMismatch: !!rateSuspicionMap[row.rowKey],
      suspectedRateReason: rateSuspicionMap[row.rowKey] || "",
      autoRepriceEligible: isMakeupZeroEligible,
      autoRepriced: isMakeupZeroEligible && rateAdjusted,
      suggestedRate: suggestedRate > 0 ? suggestedRate : 0,
      rateManuallyAdjusted: manualRate > 0
    });
  }

  var pureTeachingHours = 0;
  Object.keys(recognizedIntervalsByDay).forEach(function(dateKey) {
    var mergedHours = mergePayrollIntervalsToHours_(recognizedIntervalsByDay[dateKey]);
    dayMap[dateKey].pureTeachingHours = mergedHours;
    pureTeachingHours += mergedHours;
  });

  var ratioPay = totalRecognizedNet * (options.ratioPercent / 100);
  var hourlyPay = (pureTeachingHours * options.hourlyRate) + totalOneToOneRatioSettlement;
  var estimatedPay = options.salaryMode === "hourly" ? hourlyPay : ratioPay;

  Object.keys(dayMap).forEach(function(dateKey) {
    var day = dayMap[dateKey];
    var daySettlement = options.salaryMode === "hourly"
      ? ((day.pureTeachingHours * options.hourlyRate) + (day.oneToOneRatioSettlement || 0))
      : (day.netSales * (options.ratioPercent / 100));
    day.settlementAmount = Math.round(daySettlement);
    day.oneToOneRatioSettlement = Math.round(day.oneToOneRatioSettlement || 0);
  });

  Object.keys(typeFinanceMap).forEach(function(typeName) {
    var bucket = typeFinanceMap[typeName];
    bucket.hours = roundPayrollNumber_(bucket.hours, 2);
    bucket.hourlyHoursEligible = roundPayrollNumber_(bucket.hourlyHoursEligible || 0, 2);
    bucket.gross = Math.round(bucket.gross);
    bucket.net = Math.round(bucket.net);
    bucket.canceled = Math.round(bucket.canceled || 0);
    bucket.canceledCount = Math.round(bucket.canceledCount || 0);
    bucket.oneToOneRatioSettlement = Math.round(bucket.oneToOneRatioSettlement || 0);
    if (options.salaryMode === "hourly") {
      bucket.settlement = Math.round((bucket.hourlyHoursEligible * options.hourlyRate) + bucket.oneToOneRatioSettlement);
    } else {
      bucket.settlement = Math.round(bucket.net * (options.ratioPercent / 100));
    }
  });

  return {
    kpi: {
      totalLessons: filteredRows.length,
      recognizedLessons: recognizedLessonCount,
      recognizedHours: roundPayrollNumber_(totalRecognizedHours, 2),
      pureTeachingHours: roundPayrollNumber_(pureTeachingHours, 2),
      grossSales: Math.round(totalRecognizedGross),
      discount: Math.round(totalRecognizedDiscount),
      netSales: Math.round(totalRecognizedNet),
      canceledAmount: Math.round(totalCanceledAmount),
      oneToOneRatioSettlement: Math.round(totalOneToOneRatioSettlement),
      workingDays: Object.keys(workingDayMap).length,
      estimatedPay: Math.round(estimatedPay),
      ratioPay: Math.round(ratioPay),
      hourlyPay: Math.round(hourlyPay)
    },
    classTypeSummary: Object.keys(typeTotals).map(function(typeName) {
      return { type: typeName, count: typeTotals[typeName] };
    }).sort(function(a, b) { return b.count - a.count; }),
    classTypeFinanceSummary: Object.keys(typeFinanceMap).map(function(typeName) {
      return typeFinanceMap[typeName];
    }).sort(function(a, b) { return b.net - a.net; }),
    attendanceSummary: Object.keys(attendanceTotals).map(function(code) {
      return { code: code, count: attendanceTotals[code] };
    }).sort(function(a, b) { return b.count - a.count; }),
    calendar: buildPayrollCalendarData_(monthMeta, dayMap),
    chart: buildPayrollChartData_(monthMeta, dayMap),
    rows: detailRows
  };
}

function buildPayrollTeacherOptions_(rows) {
  var teacherMap = {};
  var teacherSubjectCounter = {};
  rows.forEach(function(row) {
    var name = String(row.teacher || "").trim();
    if (!name) return;
    teacherMap[name] = true;
    if (!teacherSubjectCounter[name]) teacherSubjectCounter[name] = {};
    teacherSubjectCounter[name][row.subject] = (teacherSubjectCounter[name][row.subject] || 0) + 1;
  });
  var teachers = Object.keys(teacherMap);
  teachers.sort(function(a, b) { return a.localeCompare(b, "ko"); });

  var groupMap = {};
  teachers.forEach(function(name) {
    var subject = resolvePayrollTeacherMainSubject_(teacherSubjectCounter[name] || {});
    if (!groupMap[subject]) groupMap[subject] = [];
    groupMap[subject].push(name);
  });

  var subjectOrder = ["수학", "영어", "국어", "과학", "사회", "논술", "기타"];
  var subjects = Object.keys(groupMap).sort(function(a, b) {
    var ai = subjectOrder.indexOf(a);
    var bi = subjectOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, "ko");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  var groups = subjects.map(function(subject) {
    groupMap[subject].sort(function(a, b) { return a.localeCompare(b, "ko"); });
    return { subject: subject, teachers: groupMap[subject] };
  });
  subjects.unshift("");
  return { subjects: subjects, teachers: teachers, groups: groups };
}

function buildPayrollCalendarData_(monthMeta, dayMap) {
  var firstWeekday = new Date(monthMeta.year, monthMeta.month - 1, 1).getDay();
  var weeks = [];
  var currentWeek = [];
  var tz = Session.getScriptTimeZone() || "Asia/Seoul";

  for (var i = 0; i < firstWeekday; i++) currentWeek.push(null);

  for (var day = 1; day <= monthMeta.daysInMonth; day++) {
    var dateObj = new Date(monthMeta.year, monthMeta.month - 1, day);
    var dateKey = Utilities.formatDate(dateObj, tz, "yyyy-MM-dd");
    var raw = dayMap[dateKey];
    var classTypes = [];
    if (raw && raw.classTypeMap) {
      classTypes = Object.keys(raw.classTypeMap).sort(function(a, b) {
        return raw.classTypeMap[b] - raw.classTypeMap[a];
      });
    }
    var classTypeHours = [];
    if (raw && raw.classTypeHourMap) {
      classTypeHours = Object.keys(raw.classTypeHourMap).map(function(typeName) {
        return { type: typeName, hours: roundPayrollNumber_(raw.classTypeHourMap[typeName], 2) };
      }).sort(function(a, b) { return b.hours - a.hours; });
    }
    currentWeek.push({
      day: day,
      dateKey: dateKey,
      recognizedHours: roundPayrollNumber_(raw ? raw.recognizedHours : 0, 2),
      pureTeachingHours: roundPayrollNumber_(raw ? raw.pureTeachingHours : 0, 2),
      netSales: Math.round(raw ? raw.netSales : 0),
      settlementAmount: Math.round(raw ? raw.settlementAmount : 0),
      canceledAmount: Math.round(raw ? raw.canceledAmount : 0),
      lessonCount: raw ? raw.lessonCount : 0,
      classTypes: classTypes,
      classTypeHours: classTypeHours
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return {
    year: monthMeta.year,
    month: monthMeta.month,
    weeks: weeks
  };
}

function buildPayrollChartData_(monthMeta, dayMap) {
  var labels = [];
  var grossSales = [];
  var netSales = [];
  var recognizedHours = [];
  var pureTeachingHours = [];
  var tz = Session.getScriptTimeZone() || "Asia/Seoul";

  for (var day = 1; day <= monthMeta.daysInMonth; day++) {
    var dateObj = new Date(monthMeta.year, monthMeta.month - 1, day);
    var dateKey = Utilities.formatDate(dateObj, tz, "yyyy-MM-dd");
    var row = dayMap[dateKey];
    labels.push(String(day));
    grossSales.push(Math.round(row ? row.grossSales : 0));
    netSales.push(Math.round(row ? row.netSales : 0));
    recognizedHours.push(roundPayrollNumber_(row ? row.recognizedHours : 0, 2));
    pureTeachingHours.push(roundPayrollNumber_(row ? row.pureTeachingHours : 0, 2));
  }

  return {
    labels: labels,
    grossSales: grossSales,
    netSales: netSales,
    recognizedHours: recognizedHours,
    pureTeachingHours: pureTeachingHours
  };
}

function evaluatePayrollAttendance_(attendance, freeIncluded) {
  var status = String(attendance || "").replace(/\s+/g, "");
  if (!status) return { recognized: false, freeEligible: false, label: "미인정" };
  if (/당일취소|당취/.test(status)) return { recognized: false, freeEligible: false, label: "당일취소 미인정" };
  if (/프리/.test(status)) {
    return {
      recognized: !!freeIncluded,
      freeEligible: true,
      label: freeIncluded ? "프리 수동인정" : "프리 미인정"
    };
  }
  if (/결석보강/.test(status)) return { recognized: true, freeEligible: false, label: "결석보강 인정" };
  if (/보강|보충/.test(status)) return { recognized: true, freeEligible: false, label: "보강 인정" };
  if (/지각/.test(status)) return { recognized: true, freeEligible: false, label: "지각 인정" };
  if (/출석/.test(status)) return { recognized: true, freeEligible: false, label: "출석 인정" };
  return { recognized: false, freeEligible: false, label: "미인정" };
}

function applyPayrollRecognitionOverride_(baseInfo, overrideValue) {
  if (typeof overrideValue !== "boolean") return baseInfo;
  return {
    recognized: overrideValue,
    freeEligible: baseInfo.freeEligible,
    label: overrideValue ? "수동 인정" : "수동 제외"
  };
}

function resolvePayrollTeacherMainSubject_(counterMap) {
  var subject = "기타";
  var max = -1;
  Object.keys(counterMap || {}).forEach(function(key) {
    var count = counterMap[key] || 0;
    if (count > max) {
      max = count;
      subject = key;
    }
  });
  return subject;
}

function toPayrollRecognitionOverrideMap_(list) {
  var map = {};
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    var item = arr[i] || {};
    var key = String(item.rowKey || "").trim();
    if (!key) continue;
    if (typeof item.recognized !== "boolean") continue;
    map[key] = item.recognized;
  }
  return map;
}

function toPayrollRateAdjustmentMap_(list) {
  var map = {};
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    var item = arr[i] || {};
    var key = String(item.rowKey || "").trim();
    var rate = toPayrollNumber_(item.rate);
    if (!key || rate <= 0) continue;
    map[key] = rate;
  }
  return map;
}

function isPayrollMakeupZeroAmountEligible_(row) {
  if (!row) return false;
  if (row.attendanceCode !== "보강") return false;
  if (toPayrollNumber_(row.amount) !== 0) return false;
  var text = (String(row.note || "") + " " + String(row.className || "")).replace(/\s+/g, "");
  return /당일취소|당취/.test(text);
}

function buildPayrollStudentRateBaseline_(rows) {
  var bucket = {};
  rows.forEach(function(row) {
    if (!row || !row.name || row.rate <= 0 || row.amount <= 0) return;
    var keys = [
      [row.name, row.subject, row.classType].join("|"),
      [row.name, "", row.classType].join("|"),
      [row.name, row.subject, ""].join("|"),
      [row.name, "", ""].join("|")
    ];
    keys.forEach(function(k) {
      if (!bucket[k]) bucket[k] = [];
      bucket[k].push(row.rate);
    });
  });

  var baseline = {};
  Object.keys(bucket).forEach(function(k) {
    var rates = bucket[k];
    if (!rates || !rates.length) return;
    var freq = {};
    rates.forEach(function(rate) {
      var kk = String(Math.round(rate));
      freq[kk] = (freq[kk] || 0) + 1;
    });
    var bestRate = 0;
    var bestCount = -1;
    Object.keys(freq).forEach(function(kk) {
      if (freq[kk] > bestCount) {
        bestCount = freq[kk];
        bestRate = parseFloat(kk);
      }
    });
    if (bestRate > 0) baseline[k] = bestRate;
  });
  return baseline;
}

function resolvePayrollSuggestedRate_(row, baselineMap) {
  if (!row || !baselineMap || !row.name) return 0;
  var keys = [
    [row.name, row.subject, row.classType].join("|"),
    [row.name, "", row.classType].join("|"),
    [row.name, row.subject, ""].join("|"),
    [row.name, "", ""].join("|")
  ];
  for (var i = 0; i < keys.length; i++) {
    var val = toPayrollNumber_(baselineMap[keys[i]]);
    if (val > 0) return val;
  }
  return 0;
}

function mergePayrollIntervalsToHours_(intervals) {
  if (!intervals || !intervals.length) return 0;
  var sorted = intervals.slice().sort(function(a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  });
  var total = 0;
  var currentStart = sorted[0][0];
  var currentEnd = sorted[0][1];

  for (var i = 1; i < sorted.length; i++) {
    var next = sorted[i];
    if (next[0] <= currentEnd) {
      if (next[1] > currentEnd) currentEnd = next[1];
      continue;
    }
    total += (currentEnd - currentStart);
    currentStart = next[0];
    currentEnd = next[1];
  }
  total += (currentEnd - currentStart);
  return roundPayrollNumber_(total / 60, 2);
}

function detectPayrollRateSuspicionMap_(rows) {
  var signatureMap = {};
  var studentMap = {};
  rows.forEach(function(row) {
    if (row.rate <= 0) return;
    var key = row.teacher + "|" + row.rateSignature;
    if (!signatureMap[key]) signatureMap[key] = [];
    signatureMap[key].push(row.rate);
    var studentKey = [row.teacher, row.name, row.classType, row.subject].join("|");
    if (!studentMap[studentKey]) studentMap[studentKey] = [];
    studentMap[studentKey].push(row.rate);
  });

  var baselineMap = {};
  Object.keys(signatureMap).forEach(function(key) {
    var rates = signatureMap[key];
    if (!rates || rates.length < 5) return;
    var freq = {};
    rates.forEach(function(rate) {
      var k = String(Math.round(rate));
      freq[k] = (freq[k] || 0) + 1;
    });
    var topKey = "";
    var topCount = 0;
    Object.keys(freq).forEach(function(k) {
      if (freq[k] > topCount) {
        topCount = freq[k];
        topKey = k;
      }
    });
    if (topCount < 3) return;
    baselineMap[key] = { rate: parseFloat(topKey), count: topCount, total: rates.length };
  });

  var studentBaselineMap = {};
  Object.keys(studentMap).forEach(function(key) {
    var rates = studentMap[key] || [];
    if (rates.length < 2) return;
    var freq = {};
    rates.forEach(function(rate) {
      var k = String(Math.round(rate));
      freq[k] = (freq[k] || 0) + 1;
    });
    var topKey = "";
    var topCount = 0;
    Object.keys(freq).forEach(function(k) {
      if (freq[k] > topCount) {
        topCount = freq[k];
        topKey = k;
      }
    });
    if (topCount < 2) return;
    studentBaselineMap[key] = parseFloat(topKey);
  });

  var suspicionMap = {};
  rows.forEach(function(row) {
    if (row.rate <= 0) return;
    var studentKey = [row.teacher, row.name, row.classType, row.subject].join("|");
    var studentBaseline = studentBaselineMap[studentKey];
    if (studentBaseline > 0) {
      var studentGap = Math.abs(row.rate - studentBaseline) / studentBaseline;
      var studentAbs = Math.abs(row.rate - studentBaseline);
      if (studentGap >= 0.07 && studentAbs >= 3000) {
        suspicionMap[row.rowKey] = "학생 기준 " + Math.round(studentBaseline).toLocaleString("ko-KR") + "원 대비 이탈";
      }
      return;
    }

    var baseline = baselineMap[row.teacher + "|" + row.rateSignature];
    if (!baseline) return;
    var gap = Math.abs(row.rate - baseline.rate) / baseline.rate;
    var absGap = Math.abs(row.rate - baseline.rate);
    if (gap < 0.15 || absGap < 7000) return;
    suspicionMap[row.rowKey] = "기준 " + Math.round(baseline.rate).toLocaleString("ko-KR") + "원 대비 이탈";
  });
  return suspicionMap;
}

function toPayrollKeySet_(list) {
  var map = {};
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    var key = String(arr[i] || "").trim();
    if (key) map[key] = true;
  }
  return map;
}

function toPayrollNumber_(value) {
  if (typeof value === "number") return isNaN(value) ? 0 : value;
  var text = String(value || "").replace(/,/g, "").replace(/[^\d.\-]/g, "");
  if (!text) return 0;
  var num = parseFloat(text);
  return isNaN(num) ? 0 : num;
}

function roundPayrollNumber_(value, digits) {
  var d = Math.pow(10, digits || 0);
  return Math.round((value || 0) * d) / d;
}

function clampPayrollNumber_(value, min, max, fallback) {
  var num = isNaN(value) ? fallback : value;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function computePayrollHourDiff_(startText, endText) {
  var start = parsePayrollTimeMinutes_(startText);
  var end = parsePayrollTimeMinutes_(endText);
  if (start === null || end === null || end <= start) return 0;
  return roundPayrollNumber_((end - start) / 60, 2);
}

function parsePayrollTimeMinutes_(text) {
  var raw = String(text || "").trim();
  if (!raw) return null;

  var m = raw.match(/(오전|오후)?\s*(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return null;
  var period = m[1] || "";
  var hour = parseInt(m[2], 10);
  var minute = parseInt(m[3], 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  if (period === "오후" && hour < 12) hour += 12;
  if (period === "오전" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}
