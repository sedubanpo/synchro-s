import assert from "node:assert/strict";
import {
  buildSchoolIconRegistry,
  getSchoolName,
  normalizeSharedIconName,
  resolveSchoolIconUrl
} from "../lib/sharedIcons";

const registry = buildSchoolIconRegistry([
  {
    category: "SCHOOL",
    lookupKey: "school:세화고",
    aliases: ["세화고등학교", "  세화 고  "],
    imageUrl: "https://assets.example/sehwa.webp",
    status: "ACTIVE"
  },
  {
    category: "SCHOOL",
    lookupKey: "school:상문고",
    aliases: [],
    imageUrl: "https://assets.example/sangmoon.svg",
    status: "ACTIVE"
  },
  {
    category: "SCHOOL",
    lookupKey: "school:중지학교",
    imageUrl: "https://assets.example/inactive.png",
    status: "INACTIVE"
  }
]);

assert.equal(normalizeSharedIconName("  SeHwa   High  "), "sehwa high");
assert.equal(getSchoolName({ secondary: "세화고 · 2학년" }), "세화고");
assert.equal(getSchoolName({ school: "상문고", secondary: "다른 학교 · 1학년" }), "상문고");
assert.equal(resolveSchoolIconUrl(registry, { secondary: "세화고 · 2학년" }), "https://assets.example/sehwa.webp");
assert.equal(resolveSchoolIconUrl(registry, { school: "세화고등학교" }), "https://assets.example/sehwa.webp");
assert.equal(resolveSchoolIconUrl(registry, { school: "세화 고" }), "https://assets.example/sehwa.webp");
assert.equal(resolveSchoolIconUrl(registry, { school: "상문고" }), "https://assets.example/sangmoon.svg");
assert.equal(resolveSchoolIconUrl(registry, { school: "중지학교" }), undefined);
assert.equal(resolveSchoolIconUrl(registry, { school: "미등록학교" }), undefined);

console.log("학교 엠블럼 직접 키·별칭·확장자 무관 URL·미등록 fallback 검증 완료");
