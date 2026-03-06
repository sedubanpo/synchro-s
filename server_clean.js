// [서버 코드] Code.gs - V57 (V40 Original Logic)
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('에스에듀 반포관 시간표 V57')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl("https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png");
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
