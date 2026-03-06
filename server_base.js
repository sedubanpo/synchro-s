// [서버 코드] Code.gs - V57 (V40 Original Logic)
var AUTH_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";
var MASTER_LOGIN_ID = "010-4232-7428";
var AUTH_CACHE_KEY = "TEACHER_AUTH_V2";

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('에스에듀 반포관 시간표 V60')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl("https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png");
}

function normalizeLoginId_(value) {
  var s = String(value || "").trim();
  var digits = s.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  if (digits.length === 10 && digits.indexOf("10") === 0) return "0" + digits;
  if (digits.length === 8) return digits;
  return s;
}

function buildLoginKeys_(value) {
  var normalized = normalizeLoginId_(value);
  var keys = [normalized];
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) keys.push(digits.slice(-8));
  if (digits.length === 10 && digits.indexOf("10") === 0) {
    keys.push("0" + digits);
    keys.push(digits.slice(-8));
  }
  if (digits.length === 8) keys.push("010" + digits);
  return keys.filter(function(v, idx, arr){ return v && arr.indexOf(v) === idx; });
}

function extractTeacherName_(teacherItem) {
  var text = String(teacherItem || "");
  var withSuffix = text.match(/([가-힣A-Za-z]+)\s*T\b/);
  if (withSuffix && withSuffix[1]) return withSuffix[1].trim();
  var compact = text.match(/([가-힣A-Za-z]+)T/);
  if (compact && compact[1]) return compact[1].trim();
  var token = text.split(/\s+/).pop() || "";
  return token.replace(/T/g, "").trim();
}

function sanitizePassword_(value) {
  return String(value || "").replace(/\u00A0/g, " ").trim();
}

function matchesDefaultPassword_(inputPw, loginIdRaw) {
  var input = sanitizePassword_(inputPw);
  var login = String(loginIdRaw || "").trim();
  if (!input || !login) return false;
  if (input === login) return true;

  var inputDigits = input.replace(/\D/g, "");
  var loginDigits = login.replace(/\D/g, "");
  if (!inputDigits || !loginDigits) return false;
  if (inputDigits === loginDigits) return true;
  if (loginDigits.length === 11 && inputDigits === loginDigits.slice(-8)) return true;
  if (loginDigits.length === 10 && loginDigits.indexOf("10") === 0) {
    var fixed = "0" + loginDigits;
    if (inputDigits === fixed || inputDigits === fixed.slice(-8)) return true;
  }
  return false;
}

function verifyPasswordForAccount_(account, inputPw) {
  if (!account) return false;
  if (account.password) return sanitizePassword_(inputPw) === account.password;
  return matchesDefaultPassword_(inputPw, account.loginId);
}

function getTeacherAuthData_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get(AUTH_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }

  var authSS = SpreadsheetApp.openById(AUTH_SPREADSHEET_ID);
  var sheet = authSS.getSheets()[0];
  var values = sheet.getDataRange().getDisplayValues();
  var byId = {};
  var teacherNames = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var loginIdRaw = row[0] || "";
    var teacherName = (row[1] || "").trim();
    var pw = sanitizePassword_(row[6]);
    if (!loginIdRaw) continue;

    var account = {
      loginId: String(loginIdRaw).trim(),
      teacherName: teacherName,
      password: pw,
      isMaster: normalizeLoginId_(loginIdRaw) === normalizeLoginId_(MASTER_LOGIN_ID)
    };
    buildLoginKeys_(loginIdRaw).forEach(function(key) {
      byId[key] = account;
    });

    if (teacherName && teacherNames.indexOf(teacherName) === -1) teacherNames.push(teacherName);
  }

  teacherNames.sort();
  var result = { byId: byId, teacherNames: teacherNames };
  cache.put(AUTH_CACHE_KEY, JSON.stringify(result), 300);
  return result;
}

function authenticateTeacher(loginId, password) {
  try {
    var auth = getTeacherAuthData_(false);
    var keys = buildLoginKeys_(loginId);
    var account = null;
    for (var i = 0; i < keys.length; i++) {
      if (auth.byId[keys[i]]) {
        account = auth.byId[keys[i]];
        break;
      }
    }
    if (!account) {
      auth = getTeacherAuthData_(true);
      for (var j = 0; j < keys.length; j++) {
        if (auth.byId[keys[j]]) {
          account = auth.byId[keys[j]];
          break;
        }
      }
    }
    if (!account) return { ok: false, message: "아이디를 찾을 수 없습니다." };

    var inputPw = sanitizePassword_(password);
    if (!verifyPasswordForAccount_(account, inputPw)) {
      auth = getTeacherAuthData_(true);
      account = null;
      for (var k = 0; k < keys.length; k++) {
        if (auth.byId[keys[k]]) {
          account = auth.byId[keys[k]];
          break;
        }
      }
      if (!verifyPasswordForAccount_(account, inputPw)) return { ok: false, message: "비밀번호가 올바르지 않습니다." };
    }

    return {
      ok: true,
      loginId: account.loginId,
      teacherName: account.teacherName || "",
      isMaster: account.isMaster,
      teacherNames: auth.teacherNames
    };
  } catch (e) {
    return { ok: false, message: "로그인 처리 중 오류: " + e.message };
  }
}

function getTeacherGridData(sheetName, teacherName, forceRefresh) {
  try {
    var selectedTeacher = String(teacherName || "").trim();
    if (!selectedTeacher) return getFixedGridData(sheetName, forceRefresh);

    var cache = CacheService.getScriptCache();
    var cacheKey = "TEACHER_GRID_V1_" + sheetName + "_" + selectedTeacher;
    if (!forceRefresh) {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    var base = getFixedGridData(sheetName, forceRefresh);
    if (!base || base.error) return base;

    var filtered = {};
    for (var h = 9; h <= 22; h++) {
      var row = base.grid[h] || [];
      filtered[h] = row.map(function(items) {
        var list = items || [];
        var teacherItem = list.find(function(item) { return String(item || "").includes("T"); });
        if (!teacherItem) return [];
        var name = extractTeacherName_(teacherItem);
        if (name !== selectedTeacher) return [];
        return list;
      });
    }

    var result = {
      headers: base.headers || [],
      grid: filtered,
      version: String(base.version || "") + "_T_" + selectedTeacher
    };
    cache.put(cacheKey, JSON.stringify(result), 120);
    return result;
  } catch (e) {
    return { error: "TEACHER_GRID_ERR: " + e.message };
  }
}

function getSheetNames() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheets()
      .map(function(s) { return s.getName(); })
      .filter(function(n) { 
        return !n.includes("-엑세스") && !n.includes("업무") && !n.includes("데이터") && !n.includes("@") && (n.match(/\d/) !== null); 
      });
  } catch (e) { return ["ERROR: " + e.message]; }
}

function checkDataVersion(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = sheetName ? ss.getSheetByName(sheetName) : null;
    if (!sheet) return "ERROR";
    return sheet.getLastRow() + "_" + sheet.getLastColumn() + "_" + sheet.getRange(1,1).getValue();
  } catch (e) { return "ERROR"; }
}

function getFixedGridData(sheetName, forceRefresh) {
  try {
    var cache = CacheService.getScriptCache();
    // [중요] 캐시 키 V58로 변경하여 기존 오류 데이터 무시
    var cacheKey = "SHEET_DATA_V58_" + sheetName;

    if (!forceRefresh) {
      var cachedJSON = cache.get(cacheKey);
      if (cachedJSON) return JSON.parse(cachedJSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = sheetName ? ss.getSheetByName(sheetName) : null;
    if (!sheet) return { error: "시트를 찾을 수 없습니다." };

    // V40 로직 그대로 사용 (getDisplayValues 사용)
    var values = sheet.getDataRange().getDisplayValues();
    if (!values || values.length === 0) return { headers: [], grid: {}, version: 0 };

    var headerRowIndex = -1;
    for (var i = 0; i < Math.min(20, values.length); i++) {
      var rowStr = values[i].join("");
      if (rowStr.includes("강의실") || rowStr.includes("1관") || rowStr.includes("2관")) {
        headerRowIndex = i; break;
      }
    }
    if (headerRowIndex === -1) headerRowIndex = values.length > 1 ? 1 : 0;

    var headerRow = values[headerRowIndex];
    var classrooms = []; 
    for (var col = 1; col < headerRow.length; col++) {
      var cellText = headerRow[col].trim();
      if (cellText !== "") {
        if (classrooms.length > 0 && classrooms[classrooms.length - 1].name === cellText) {
        } else {
           if (classrooms.length > 0) classrooms[classrooms.length - 1].endCol = col - 1;
           classrooms.push({ name: cellText, startCol: col, endCol: col });
        }
      }
    }
    if (classrooms.length > 0) classrooms[classrooms.length - 1].endCol = headerRow.length - 1;

    var gridData = {}; 
    for (var h = 9; h <= 22; h++) gridData[h] = classrooms.map(function() { return []; });

    var currentHour = -1; 
    var skipKeywords = ["결석","보강","직보","취소","계획","당일","이후","변경","개학시간표","개학","정규","등원","수업","진행","예정","필드","오늘만","시험","휴식","보충","직전","주말","질문","클리닉"];
    var moveNoticePattern = /(시간|반|자리|교실)\s*이동|이동\s*(예정|완료|요청)/;
    var datePattern = /\d+\/\d+/; 

    for (var i = headerRowIndex + 1; i < values.length; i++) {
      var row = values[i];
      var timeText = row[0] ? row[0].trim() : "";
      if (timeText.includes(":")) {
        var match = timeText.match(/(\d+):/);
        if (match) {
          var rawHour = parseInt(match[1]);
          if (timeText.includes("오후") && rawHour < 12) rawHour += 12;
          if (!timeText.includes("~")) { if (rawHour >= 23) currentHour = -1; else currentHour = rawHour; }
        }
      }
      if (currentHour >= 9 && currentHour <= 22) {
        classrooms.forEach(function(room, roomIndex) {
          var parts = [];
          for (var c = room.startCol; c <= room.endCol; c++) {
            var val = row[c] ? row[c].trim() : "";
            if (!val || val.startsWith("/")) continue; 
            var isHolidayCol = room.name.includes("휴강");
            if (!isHolidayCol) {
               if (datePattern.test(val)) {
                 if (!val.includes("결석예고") && !val.includes("신규") && !val.includes("첫수업") && !val.includes("당일취소")) {
                   continue; 
                 }
               }
               if (skipKeywords.some(function(k) { 
                 return val.includes(k) 
                   && !val.includes("확인필요") 
                   && !val.includes("결석예고")
                   && !val.includes("첫수업")
                   && !val.includes("신규")
                   && !val.includes("당일취소");
               })) continue;
               if (moveNoticePattern.test(val)
                 && !val.includes("확인필요")
                 && !val.includes("결석예고")
                 && !val.includes("첫수업")
                 && !val.includes("신규")
                 && !val.includes("당일취소")) continue;
            }
            parts.push(val);
          }
          if (parts.length > 0) {
            var combinedText = parts.join(" "); 
            if (!gridData[currentHour][roomIndex].includes(combinedText)) {
              gridData[currentHour][roomIndex].push(combinedText);
            }
          }
        });
      }
    }
    var result = { headers: classrooms.map(function(c) { return c.name; }), grid: gridData, version: values.length };
    try { cache.put(cacheKey, JSON.stringify(result), 21600); } catch (e) {}
    return result;
  } catch (e) { return { error: "SERVER_ERR: " + e.message }; }
}
