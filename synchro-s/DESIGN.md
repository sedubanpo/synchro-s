# Synchro-S Design Tokens

## Atmosphere

Synchro-S is a dense academy operations console. The interface should feel calm, precise, and fast to scan. Avoid landing-page styling, oversized decorative areas, and heavy visual effects.

## Color

- `--sync-bg`: `#f8fafc`, main app background.
- `--sync-surface`: `#ffffff`, primary panels and controls.
- `--sync-surface-muted`: `#f1f5f9`, subdued panel backgrounds.
- `--sync-ink`: `#0f172a`, primary text.
- `--sync-ink-muted`: `#64748b`, secondary text.
- `--sync-line`: `rgba(15, 23, 42, 0.09)`, quiet separators and surface rings.
- `--sync-line-strong`: `rgba(37, 99, 235, 0.22)`, focused timetable lines.
- `--sync-accent`: `#2563eb`, primary action and selected state.
- `--sync-accent-soft`: `#eff6ff`, primary action background.
- `--sync-success`: `#059669`, active or completed state.
- `--sync-warning`: `#d97706`, warning and transient attention.
- `--sync-temporary-soft`: `#dcfce7`, one-day temporary availability background.
- `--sync-temporary-line`: `#86efac`, one-day temporary availability border.
- `--sync-temporary-ink`: `#166534`, one-day temporary availability text.
- `--sync-danger`: `#e11d48`, destructive action.
- `--sync-danger-soft`: `#fff1f2`, unavailable-date and destructive-state background.
- `--sync-scroll-thumb`: `#cbd5e1`, compact timetable scrollbar thumb.
- Class-type planning tones: blue for `1:1`, violet for `2:1`, rose for `3:1`, amber for `개별정규`.
- Instructor picker subject tones: rose for Korean, blue for math, purple for English, emerald for science, amber for social studies, and slate for uncategorized instructors. Every tone is paired with a written subject-family badge so color is never the only cue.
- Full timetable lesson cards reuse those subject-family tones while retaining the written subject label; `1:1` keeps its gold border and type badge over the subject tint.
- Import progress gradient: emerald `#34d399`, blue `#60a5fa`, violet `#a78bfa`.
- Schedule tag tones reuse the existing blue, emerald, amber, rose, violet, and slate UI scales.
- Recent save-history tag labels use the saved schedule-tag tone at pastel intensity; they are secondary metadata and must not compete with the student name.
- School emblems may appear as oversized, clipped, color-retaining backdrops in student-owned surfaces. Keep opacity between `5%` and `9%`, soften saturation without removing school colors, preserve readable foreground contrast, and omit the backdrop when no emblem is registered.
- Quick lesson cards tint the whole card by subject family. Instructor name is the dominant line; the written subject remains a compact rectangular label, never a speech-bubble treatment.
- Quick lesson cards use quiet, code-native subject motifs behind content: manuscript for Korean, geometry for math, letterforms for English, scientific diagrams for science families, and a globe for social studies. Motifs stay below `10%` opacity and never replace the written subject label.
- Class type is encoded with both text and a compact geometric signal: capacity dots for ratio lessons, a flowing track for regular multi lessons, and a starburst for special lectures. Capacity and optional operating memo remain readable metadata.

## Typography

- Font stack: `"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`.
- Headings: 700-900 weight, `text-wrap: balance`.
- UI descriptions and helper text: `text-wrap: pretty`.
- Counts, dates, and times: tabular numerals.

## Spacing

- Dense control gap: `0.375rem`.
- Panel padding: `0.75rem` to `1rem`.
- Save-history rail width: `15.5rem` on supported desktop layouts, with a fixed footer for grouped-result pagination.
- Timetable cell inner padding: `0.25rem`.
- Multi-date timetable column minimum: `9.5rem`, preserving student names before horizontal scrolling.
- Minimum practical hit area: `2.5rem` when layout allows.
- Instructor picker: one horizontally stable board with six fixed subject-family columns in `국어 → 수학 → 영어 → 사회 → 과학 → 기타` order. Keep a single outer scroll container, sticky family headings, Korean alphabetical name order, and explicit selected text.

## Shape

- Control radius: `0.5rem`.
- Panel radius: `0.75rem`.
- Compact pill radius: `9999px`.
- Nested rounded surfaces should use a smaller inner radius than the outer panel.

## Depth

- `--sync-shadow-surface`: ring plus two soft shadow layers for cards and panels.
- `--sync-shadow-hover`: slightly stronger ring and lift for interactive cards.
- Keep table grid boundaries as borders because they are structural dividers.

## Motion

- Interactive state transitions should target exact properties: `background-color`, `border-color`, `box-shadow`, `color`, `opacity`, `transform`.
- Press feedback uses `scale(0.96)`.
- Async state feedback uses a continuous spinner while pending and a `300ms` transform/opacity/filter confirmation on completion, with no bounce.
- Respect reduced motion by disabling transform transitions.
