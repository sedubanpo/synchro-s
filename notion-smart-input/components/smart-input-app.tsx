"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { ListeningOrb } from "@/components/listening-orb";
import type {
  ApiError,
  IncidentApiSuccess,
  PersonDirectoryType,
  PersonGroupLabel,
  PersonOption,
  PersonsApiSuccess
} from "@/lib/types";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "success"; data: IncidentApiSuccess }
  | { kind: "error"; data: ApiError };

type RosterMap = Record<PersonDirectoryType, PersonOption[]>;
type ErrorMap = Record<PersonDirectoryType, string | null>;
type LoadingMap = Record<PersonDirectoryType, boolean>;

const GROUP_OPTIONS: Array<{
  type: PersonDirectoryType;
  label: PersonGroupLabel;
  dbLabel: string;
}> = [
  { type: "student", label: "재원생", dbLabel: "Student DB" },
  { type: "instructor", label: "강사", dbLabel: "Instructor DB" },
  { type: "staff", label: "실무자", dbLabel: "Staff DB" }
];

const EMPTY_ROSTERS: RosterMap = {
  student: [],
  instructor: [],
  staff: []
};

const EMPTY_ERRORS: ErrorMap = {
  student: null,
  instructor: null,
  staff: null
};
const EMPTY_LOADING: LoadingMap = {
  student: true,
  instructor: true,
  staff: true
};
const PRELOAD_RELEASE_MS = 1600;

function getTodayInSeoul() {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return "";
  }

  return `${year}-${month}-${day}`;
}

export function SmartInputApp() {
  const [group, setGroup] = useState<PersonDirectoryType>("student");
  const [rosters, setRosters] = useState<RosterMap>(EMPTY_ROSTERS);
  const [rosterErrors, setRosterErrors] = useState<ErrorMap>(EMPTY_ERRORS);
  const [rosterLoading, setRosterLoading] = useState<LoadingMap>(EMPTY_LOADING);
  const [personPageId, setPersonPageId] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [targetDate, setTargetDate] = useState(getTodayInSeoul());
  const [preloading, setPreloading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [typingActive, setTypingActive] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });
  const typingTimerRef = useRef<number | null>(null);
  const deferredPersonQuery = useDeferredValue(personQuery);

  useEffect(() => {
    let active = true;
    const controllers = GROUP_OPTIONS.map(() => new AbortController());
    let settledCount = 0;
    const releaseTimer = window.setTimeout(() => {
      if (active) {
        setRosterLoading({
          student: false,
          instructor: false,
          staff: false
        });
        setPreloading(false);
      }
    }, PRELOAD_RELEASE_MS);

    setPreloading(true);
    setRosterLoading(EMPTY_LOADING);
    setRosterErrors(EMPTY_ERRORS);

    function completeOne(type: PersonDirectoryType) {
      settledCount += 1;

      if (!active) {
        return;
      }

      setRosterLoading((previous) => ({
        ...previous,
        [type]: false
      }));

      if (settledCount >= GROUP_OPTIONS.length) {
        window.clearTimeout(releaseTimer);
        setPreloading(false);
      }
    }

    async function loadRoster(option: (typeof GROUP_OPTIONS)[number], index: number) {
      try {
        const response = await fetch(`/api/persons?type=${option.type}`, {
          signal: controllers[index].signal
        });
        const payload = (await response
          .json()
          .catch(() => null)) as PersonsApiSuccess | ApiError | null;

        if (!active) {
          return;
        }

        if (response.ok && payload && payload.ok) {
          setRosters((previous) => ({
            ...previous,
            [option.type]: payload.persons
          }));
          setRosterErrors((previous) => ({
            ...previous,
            [option.type]: null
          }));
          return;
        }

        setRosters((previous) => ({
          ...previous,
          [option.type]: []
        }));
        setRosterErrors((previous) => ({
          ...previous,
          [option.type]:
            payload && "error" in payload
              ? payload.error
              : `${option.label} 명단을 불러오지 못했습니다.`
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setRosters((previous) => ({
          ...previous,
          [option.type]: []
        }));
        setRosterErrors((previous) => ({
          ...previous,
          [option.type]: error instanceof Error ? error.message : "명단을 불러오지 못했습니다."
        }));
      } finally {
        completeOne(option.type);
      }
    }

    void Promise.allSettled(GROUP_OPTIONS.map((option, index) => loadRoster(option, index)));

    return () => {
      active = false;
      window.clearTimeout(releaseTimer);
      for (const controller of controllers) {
        controller.abort();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPersonPageId("");
    setPersonQuery("");
    setComboOpen(false);
  }, [group]);

  function pulseTyping() {
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }

    setTypingActive(true);
    typingTimerRef.current = window.setTimeout(() => {
      setTypingActive(false);
      typingTimerRef.current = null;
    }, 900);
  }

  const persons = rosters[group];
  const directoryError = rosterErrors[group];
  const currentGroupLoading = rosterLoading[group];
  const activeGroup = GROUP_OPTIONS.find((option) => option.type === group);
  const selectedPerson = persons.find((person) => person.id === personPageId);
  const visualLoading = preloading || submitting;
  const visualActive = typingActive || comboOpen || summary.trim().length > 0;
  const normalizedQuery = deferredPersonQuery.trim().toLocaleLowerCase("ko");
  const filteredPersons = normalizedQuery
    ? persons.filter((person) => person.name.toLocaleLowerCase("ko").includes(normalizedQuery))
    : persons;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!personPageId) {
      setSubmission({
        kind: "error",
        data: {
          ok: false,
          code: "INVALID_REQUEST",
          error: "대상자를 선택해 주세요."
        }
      });
      return;
    }

    if (!summary.trim()) {
      setSubmission({
        kind: "error",
        data: {
          ok: false,
          code: "INVALID_REQUEST",
          error: "특이사항 내용을 입력해 주세요."
        }
      });
      return;
    }

    try {
      setSubmitting(true);
      pulseTyping();

      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          group,
          personPageId,
          summary: summary.trim(),
          targetDate
        })
      });
      const payload = (await response.json()) as IncidentApiSuccess | ApiError;

      if (response.ok && payload.ok) {
        setSubmission({
          kind: "success",
          data: payload
        });
        setSummary("");
        setTargetDate(getTodayInSeoul());
        return;
      }

      setSubmission({
        kind: "error",
        data: payload as ApiError
      });
    } catch (error) {
      setSubmission({
        kind: "error",
        data: {
          ok: false,
          code: "INTERNAL_ERROR",
          error: error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다."
        }
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden px-3 py-3 md:px-5 md:py-5">
      <ListeningOrb loading={visualLoading} active={visualActive} />

      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_80%,rgba(8,47,73,0.08),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(2,6,23,0.18),transparent_48%)]" />

      <div className="relative z-10 flex w-full max-w-5xl flex-col gap-2 md:translate-y-8">
          {submission.kind === "error" ? (
            <div className="signal-banner signal-banner-error w-full">
              <span className="signal-dot" />
              <span>{submission.data.error}</span>
              <span className="ml-auto text-[10px] tracking-[0.28em] text-rose-200/60">{submission.data.code}</span>
            </div>
          ) : null}

          {submission.kind === "success" ? (
            <div className="signal-banner signal-banner-success w-full">
              <span className="signal-dot" />
              <span>Notion page created</span>
              {submission.data.notionPageUrl ? (
                <a
                  href={submission.data.notionPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-[10px] tracking-[0.28em] text-cyan-200/80 underline underline-offset-4"
                >
                  OPEN
                </a>
              ) : null}
            </div>
          ) : null}

          <section className="dock-shell">
            <div className="dock-head">
              <span className="status-pill px-3 py-1 text-[9px] font-medium tracking-[0.42em] text-cyan-200/80">
                INTERACTIVE HOLOGRAM TERMINAL
              </span>
              <div className="dock-meta">
                <span>{activeGroup?.dbLabel}</span>
                <span>{selectedPerson?.name ?? "No target selected"}</span>
                <span>{targetDate || "Date pending"}</span>
              </div>
            </div>

            <form className="dock-form" onSubmit={handleSubmit}>
              <div className="dock-row dock-row-controls">
                <div className="field-block field-block-compact">
                  <label className="field-label" htmlFor="group-student">
                    Group
                  </label>
                  <div className="pill-row pill-row-dock">
                    {GROUP_OPTIONS.map((option) => (
                      <button
                        key={option.type}
                        id={`group-${option.type}`}
                        type="button"
                        onClick={() => {
                          setGroup(option.type);
                          pulseTyping();
                        }}
                        className={`pill-button pill-button-mini ${group === option.type ? "is-active" : ""}`}
                        aria-pressed={group === option.type}
                      >
                        <span className="pill-dot" />
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field-block field-grow combo-shell">
                  <label className="field-label" htmlFor="personPageId">
                    Target
                  </label>
                  <div
                    className={`holo-field holo-field-minimal ${comboOpen || personQuery ? "is-engaged" : ""} ${
                      comboOpen ? "is-open" : ""
                    }`}
                  >
                    <input
                      id="personPageId"
                      className="holo-input combo-input"
                      value={personQuery}
                      onChange={(event) => {
                        setPersonQuery(event.target.value);
                        setPersonPageId("");
                        setComboOpen(true);
                        pulseTyping();
                      }}
                      onFocus={() => setComboOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setComboOpen(false);
                        }, 120);
                      }}
                        placeholder={
                          currentGroupLoading
                            ? "Loading roster..."
                            : persons.length === 0
                              ? "No entries found"
                              : "Search and select"
                        }
                        autoComplete="off"
                        disabled={currentGroupLoading && persons.length === 0}
                      role="combobox"
                      aria-expanded={comboOpen}
                      aria-controls="person-combobox-list"
                    />
                    <span className="combo-indicator" aria-hidden="true">
                      {filteredPersons.length}
                    </span>
                  </div>
                  {comboOpen && !currentGroupLoading && persons.length > 0 ? (
                    <div className="combo-panel combo-panel-dock" id="person-combobox-list" role="listbox">
                      {filteredPersons.length > 0 ? (
                        filteredPersons.slice(0, 100).map((person) => (
                          <button
                            key={person.id}
                            type="button"
                            className={`combo-option ${person.id === personPageId ? "is-active" : ""}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setPersonPageId(person.id);
                              setPersonQuery(person.name);
                              setComboOpen(false);
                              pulseTyping();
                            }}
                            role="option"
                            aria-selected={person.id === personPageId}
                          >
                            <span className="combo-option-name">{person.name}</span>
                            {person.id === personPageId ? (
                              <span className="combo-option-badge">SELECTED</span>
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <div className="combo-empty">No matching people</div>
                      )}
                    </div>
                  ) : null}
                  {directoryError ? <p className="field-note field-note-error">{directoryError}</p> : null}
                </div>

                <div className="field-block field-date-compact">
                  <label className="field-label" htmlFor="targetDate">
                    Issue Date
                  </label>
                  <div className={`holo-field holo-field-minimal ${targetDate ? "is-engaged" : ""}`}>
                    <input
                      id="targetDate"
                      type="date"
                      className="holo-input"
                      value={targetDate}
                      onChange={(event) => {
                        setTargetDate(event.target.value);
                        pulseTyping();
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="dock-row dock-row-compose">
                <div className="field-block field-grow">
                  <label className="field-label" htmlFor="summary">
                    Incident Note
                  </label>
                  <div className={`holo-field holo-field-minimal is-textarea ${summary ? "is-engaged" : ""}`}>
                    <textarea
                      id="summary"
                      className="holo-textarea dock-textarea"
                      value={summary}
                      onChange={(event) => {
                        setSummary(event.target.value);
                        pulseTyping();
                      }}
                      placeholder="Write the issue note..."
                      rows={3}
                    />
                  </div>
                </div>

                <div className="submit-column">
                  <button className="terminal-submit" type="submit" disabled={submitting || currentGroupLoading}>
                    <span>{submitting ? "Submitting..." : "Create Notion Entry"}</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
      </div>
    </main>
  );
}
