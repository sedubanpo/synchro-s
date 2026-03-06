// [서버 코드] Code.gs - V57 (V40 Original Logic)
var AUTH_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";
var MASTER_LOGIN_ID = "010-4232-7428";
var AUTH_CACHE_KEY = "TEACHER_AUTH_V2";

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  if (String(params.mode || "").toLowerCase() === "api") {
    return handleApiRequest_(params);
  }
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('에스에듀 반포관 시간표 V60')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl("https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png");
}

function handleApiRequest_(params) {
  try {
    if (!isApiAuthorized_(params)) {
      return jsonOutput_({ ok: false, error: "UNAUTHORIZED" });
    }

    var action = String(params.action || "grid").toLowerCase();
    if (action === "ping") {
      return jsonOutput_({
        ok: true,
        now: new Date().toISOString(),
        tz: Session.getScriptTimeZone() || "Asia/Seoul"
      }, params);
    }

    if (action === "sheets") {
      return jsonOutput_({ ok: true, sheets: getSheetNames() }, params);
    }

    if (action === "auth") {
      var loginId = String(params.id || "").trim();
      var password = String(params.pw || "");
      if (!loginId || !password) return jsonOutput_({ ok: false, error: "AUTH_REQUIRED" }, params);
      return jsonOutput_(authenticateTeacher(loginId, password), params);
    }

    if (action === "version") {
      var targetSheet = String(params.sheet || "").trim();
      if (!targetSheet) return jsonOutput_({ ok: false, error: "SHEET_REQUIRED" }, params);
      return jsonOutput_({ ok: true, version: checkDataVersion(targetSheet) }, params);
    }

    if (action === "grid") {
      var sheetName = String(params.sheet || "").trim();
      if (!sheetName) return jsonOutput_({ ok: false, error: "SHEET_REQUIRED" }, params);
      var teacherName = String(params.teacher || "").trim();
      var forceRefresh = String(params.refresh || "") === "1";
      var lite = String(params.lite || "1") !== "0";
      var payload = teacherName
        ? getTeacherGridData(sheetName, teacherName, forceRefresh)
        : getFixedGridData(sheetName, forceRefresh);
      if (!payload || payload.error) return jsonOutput_({ ok: false, error: payload && payload.error ? payload.error : "GRID_ERROR" }, params);
      if (lite) payload = toLitePayload_(payload);
      return jsonOutput_({ ok: true, data: payload }, params);
    }

    return jsonOutput_({ ok: false, error: "UNKNOWN_ACTION" }, params);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "API_ERR: " + err.message }, params);
  }
}

function toLitePayload_(payload) {
  var headers = (payload && payload.headers) || [];
  var grid = (payload && payload.grid) || {};
  var rows = [];
  for (var h = 9; h <= 22; h++) {
    var line = grid[h] || [];
    for (var i = 0; i < headers.length; i++) {
      var items = line[i] || [];
      if (!items.length) continue;
      rows.push({
        hour: h,
        room: headers[i],
        items: items
      });
    }
  }
  return {
    headers: headers,
    rows: rows,
    version: payload.version || ""
  };
}

function isApiAuthorized_(params) {
  var requiredToken = "";
  try {
    requiredToken = String(PropertiesService.getScriptProperties().getProperty("SCHEDULE_API_TOKEN") || "").trim();
  } catch (e) {
    requiredToken = "";
  }
  if (!requiredToken) return true;
  return String(params.token || "").trim() === requiredToken;
}

function jsonOutput_(obj, params) {
  var callback = String((params && params.callback) || "").trim();
  if (callback) {
    var safeCallback = callback.replace(/[^\w.$]/g, "");
    var body = safeCallback + "(" + JSON.stringify(obj) + ");";
    return ContentService
      .createTextOutput(body)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

function authenticateTeacher(id, password) {
  var sheetId = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName("Teachers");
  if (!sheet) sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var teacherNames = [];

  // 입력 아이디 정규화 (- 제거, 8자리일 경우 010 추가)
  var inputIdClean = String(id).replace(/[^0-9]/g, "");
  if (inputIdClean.length === 8) inputIdClean = "010" + inputIdClean;
  var inputPw = String(password).trim();

  for (var i = 1; i < data.length; i++) {
    var dbId = String(data[i][0]).replace(/[^0-9]/g, "");
    if (!dbId) continue;
    if (dbId.length === 8) dbId = "010" + dbId;

    var dbName = String(data[i][1]).trim();
    if (dbName && teacherNames.indexOf(dbName) === -1) teacherNames.push(dbName);
    var dbPw = String(data[i][6]).trim();
    // 비밀번호 공란 시 아이디(dbId)로 대체
    if (dbPw === "") dbPw = dbId;
    // 검증 및 권한 부여
    if (inputIdClean === dbId && inputPw === dbPw) {
      var isMaster = inputIdClean === "01042327428";
      return {
        ok: true,
        success: true,
        loginId: inputIdClean,
        teacherName: dbName,
        name: dbName,
        isMaster: isMaster,
        role: isMaster ? "ADMIN" : "TEACHER",
        teacherNames: teacherNames
      };
    }
  }
  return { ok: false, success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." };
}

function getTeacherGridData(sheetName, teacherName, forceRefresh) {
  try {
    var selectedTeacher = String(teacherName || "").trim();
    if (!selectedTeacher) return getFixedGridData(sheetName, forceRefresh);

    var cache = CacheService.getScriptCache();
    var cacheKey = "TEACHER_GRID_V3_" + sheetName + "_" + selectedTeacher;
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
    // [중요] 캐시 키 V61: 강의실별 한 줄 최대 셀 수 제한 반영
    var cacheKey = "SHEET_DATA_V61_" + sheetName;

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
    var skipKeywords = ["개학시간표","개학","필드","주말","질문","클리닉","휴식","직전"];
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
          var firstNonEmptyCol = -1;
          for (var c = room.startCol; c <= room.endCol; c++) {
            var val = row[c] ? row[c].trim() : "";
            if (!val || val.startsWith("/")) continue; 
            if (firstNonEmptyCol === -1) firstNonEmptyCol = c;
            var isHolidayCol = room.name.includes("휴강");
            if (!isHolidayCol) {
               if (datePattern.test(val)) {
                 var hasImportant = /(결석|지각|보강|보충|병결|당일취소|휴강|확인|확정|첫수업|신규|오늘만|특강|직보|자습|등원|분|지각예정)/.test(val);
                 if (!hasImportant) continue;
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
            if (!isHolidayCol && parts.length >= 5) {
              break;
            }
          }
          // 병합 폭이 넓은 헤더에서 인접 강의실 값이 뒤쪽 컬럼으로 섞이는 경우를 방지한다.
          // 실제 해당 강의실 데이터는 보통 시작 컬럼 부근에서 바로 시작한다.
          if (firstNonEmptyCol !== -1 && (firstNonEmptyCol - room.startCol) > 2) {
            return;
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
    var result = {
      headers: classrooms.map(function(c) { return c.name; }),
      grid: gridData,
      version: sheet.getLastRow() + "_" + sheet.getLastColumn() + "_" + sheet.getRange(1, 1).getDisplayValue()
    };
    try { cache.put(cacheKey, JSON.stringify(result), 21600); } catch (e) {}
    return result;
  } catch (e) { return { error: "SERVER_ERR: " + e.message }; }
}
