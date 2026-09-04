import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ClipboardList } from "../theme/icons";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { InlineNotice } from "../components/InlineNotice";
import { PageHeader } from "../components/PageHeader";
import { PageHelpButton } from "../components/PageHelpButton";
import { SegmentedControl } from "../components/SegmentedControl";
import { CourseDetailDialog } from "../features/study/components/CourseDetailDialog";
import { CourseFormDialog } from "../features/study/components/CourseFormDialog";
import { CourseScheduleView } from "../features/study/components/CourseScheduleView";
import { HomeworkFormDialog } from "../features/study/components/HomeworkFormDialog";
import { HomeworkView } from "../features/study/components/HomeworkView";
import { SemesterManageDialog } from "../features/study/components/SemesterManageDialog";
import {
  clampWeek,
  isDueSoon,
  isOverdue,
  weekNumberFromDate,
  type Course,
  type CourseDraft,
  type Homework,
  type HomeworkDraft,
  type StudyView,
  type WeekStart,
} from "../lib/study";
import {
  LEGACY_STUDY_STORAGE_KEY,
  copyCoursesForSemester,
  ensureDemoScenario,
  type StudyData,
} from "../lib/studyStore";
import {
  getStudyData,
  logEvent,
  saveStudyData,
  studyStoreExists,
} from "../lib/tauri";

const PREF_KEY = "rootup.study.prefs.v1";

interface StudyPrefs {
  view: StudyView;
  weekStart: WeekStart;
  showAllWeeks: boolean;
  semesterId?: string;
}

const DEFAULT_PREFS: StudyPrefs = {
  view: "schedule",
  weekStart: "monday",
  showAllWeeks: true,
};

function loadPrefs(): StudyPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<StudyPrefs>;
    return {
      view: parsed.view === "homework" ? "homework" : "schedule",
      weekStart: parsed.weekStart === "sunday" ? "sunday" : "monday",
      showAllWeeks: parsed.showAllWeeks !== false,
      semesterId:
        typeof parsed.semesterId === "string" ? parsed.semesterId : undefined,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 学业页：数据由后端 study.json 统一管理，UI 仅做展示与整份保存。*/
export function StudyPage({
  today = new Date(),
  initialData,
  reminderEnabled = false,
  leadDays = 3,
  focusHomework = null,
  onFocusConsumed,
}: {
  today?: Date;
  initialData?: StudyData;
  reminderEnabled?: boolean;
  leadDays?: number;
  focusHomework?: { homeworkId?: string } | null;
  onFocusConsumed?: () => void;
}) {
  const { t } = useTranslation();
  const [prefs] = useState(loadPrefs);
  const [data, setData] = useState<StudyData | null>(initialData ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<StudyView>(prefs.view);
  const [weekStart, setWeekStart] = useState<WeekStart>(prefs.weekStart);
  const [showAllWeeks, setShowAllWeeks] = useState(prefs.showAllWeeks);
  const [semesterId, setSemesterId] = useState("");
  const [weekOverride, setWeekOverride] = useState<number | null>(null);
  const [semesterManageOpen, setSemesterManageOpen] = useState(false);
  const [reminderBannerHidden, setReminderBannerHidden] = useState(false);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [homeworkFormOpen, setHomeworkFormOpen] = useState(false);
  const [editingHomework, setEditingHomework] = useState<Homework | null>(null);
  const [expandedHomeworkId, setExpandedHomeworkId] = useState<string | null>(
    null,
  );
  const [homeworkCourseFilter, setHomeworkCourseFilter] = useState<
    "all" | "none" | string
  >("all");
  const idSeq = useRef(0);
  const dirtyRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
  };

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      try {
        const exists = await studyStoreExists();
        const legacyRaw = localStorage.getItem(LEGACY_STUDY_STORAGE_KEY);
        if (!exists && legacyRaw) {
          try {
            const legacy = JSON.parse(legacyRaw) as StudyData;
            const merged = ensureDemoScenario(legacy);
            await saveStudyData(merged);
            localStorage.removeItem(LEGACY_STUDY_STORAGE_KEY);
          } catch (error) {
            logEvent("warn", `study: 旧数据迁移失败 ${String(error)}`);
          }
        }
        const loaded = await getStudyData();
        if (!cancelled) setData(loaded);
      } catch (error) {
        if (!cancelled) setLoadError(String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialData, reloadKey]);

  useEffect(() => {
    if (!data) return;
    const saved = prefs.semesterId;
    setSemesterId((prev) => {
      if (prev && data.semesters.some((item) => item.id === prev)) return prev;
      if (saved && data.semesters.some((item) => item.id === saved)) {
        return saved;
      }
      return data.semesters[0]?.id ?? "";
    });
  }, [data, prefs.semesterId]);

  useEffect(() => {
    if (!data || !dirtyRef.current) return;
    dirtyRef.current = false;
    saveStudyData(data).catch((error) => {
      dirtyRef.current = true;
      logEvent("warn", `study: 保存失败 ${String(error)}`);
    });
  }, [data]);

  useEffect(() => {
    if (!focusHomework || !data) return;
    if (focusHomework.homeworkId) {
      for (const [sid, list] of Object.entries(data.homeworkBySemester)) {
        if (list.some((item) => item.id === focusHomework.homeworkId)) {
          setSemesterId(sid);
          break;
        }
      }
    }
    setView("homework");
    setHomeworkCourseFilter("all");
    setExpandedHomeworkId(focusHomework.homeworkId ?? null);
    onFocusConsumed?.();
  }, [focusHomework, data, onFocusConsumed]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({ view, weekStart, showAllWeeks, semesterId }),
      );
    } catch {
      // 偏好写入失败时静默回退，不阻塞页面
    }
  }, [view, weekStart, showAllWeeks, semesterId]);

  const semester =
    data?.semesters.find((item) => item.id === semesterId) ??
    data?.semesters[0];
  const courses = semester ? (data?.coursesBySemester[semester.id] ?? []) : [];
  const homework = semester
    ? (data?.homeworkBySemester[semester.id] ?? [])
    : [];
  const actualWeek = semester
    ? weekNumberFromDate(semester.startDate, today)
    : 1;
  const currentWeek = semester
    ? clampWeek(weekOverride ?? actualWeek, semester.weekCount)
    : 1;

  const nextId = (prefix: string) =>
    `${prefix}-${Date.now()}-${(idSeq.current += 1)}`;

  const updateCourses = (updater: (list: Course[]) => Course[]) => {
    markDirty();
    setData((prev) => {
      if (!prev || !semester) return prev;
      const list = prev.coursesBySemester[semester.id] ?? [];
      return {
        ...prev,
        coursesBySemester: {
          ...prev.coursesBySemester,
          [semester.id]: updater(list),
        },
      };
    });
  };

  const updateHomework = (updater: (list: Homework[]) => Homework[]) => {
    markDirty();
    setData((prev) => {
      if (!prev || !semester) return prev;
      const list = prev.homeworkBySemester[semester.id] ?? [];
      return {
        ...prev,
        homeworkBySemester: {
          ...prev.homeworkBySemester,
          [semester.id]: updater(list),
        },
      };
    });
  };

  const saveCourse = (draft: CourseDraft) => {
    updateCourses((list) =>
      editingCourse
        ? list.map((course) =>
            course.id === editingCourse.id ? { ...course, ...draft } : course,
          )
        : [...list, { ...draft, id: nextId("c") }],
    );
  };

  const deleteCourse = (id: string) => {
    updateCourses((list) => list.filter((course) => course.id !== id));
    updateHomework((list) =>
      list.map((item) =>
        item.courseId === id ? { ...item, courseId: null } : item,
      ),
    );
    setHomeworkCourseFilter((prev) => (prev === id ? "all" : prev));
    setSelectedCourse((prev) => (prev?.id === id ? null : prev));
  };

  const saveHomework = (draft: HomeworkDraft) => {
    updateHomework((list) =>
      editingHomework
        ? list.map((item) =>
            item.id === editingHomework.id ? { ...item, ...draft } : item,
          )
        : [...list, { ...draft, id: nextId("h") }],
    );
  };

  const toggleHomeworkStatus = (id: string) => {
    updateHomework((list) =>
      list.map((item) => {
        if (item.id !== id || item.status === "archived") return item;
        return {
          ...item,
          status: item.status === "pending" ? "done" : "pending",
        };
      }),
    );
  };

  const archiveHomework = (id: string) => {
    updateHomework((list) =>
      list.map((item) =>
        item.id === id && item.status === "done"
          ? { ...item, status: "archived" }
          : item,
      ),
    );
  };

  const deleteHomework = (id: string) => {
    updateHomework((list) => list.filter((item) => item.id !== id));
  };

  const openCourseHomework = (courseId: string, homeworkId?: string) => {
    setHomeworkCourseFilter(courseId);
    setView("homework");
    setExpandedHomeworkId(homeworkId ?? null);
  };

  const handleSemesterChange = (id: string) => {
    setSemesterId(id);
    setWeekOverride(null);
    setHomeworkCourseFilter("all");
    setSelectedCourse(null);
  };

  const handleWeekChange = (week: number) => {
    if (!semester) return;
    setWeekOverride(clampWeek(week, semester.weekCount));
  };

  const handleResetWeek = () => setWeekOverride(null);

  const handleSaveSemester = (
    input: {
      name: string;
      startDate: string;
      endDate?: string;
      weekCount: number;
    },
    editingId?: string,
    copyFromId?: string,
  ) => {
    markDirty();
    if (editingId) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          semesters: prev.semesters.map((item) =>
            item.id === editingId ? { ...item, ...input } : item,
          ),
        };
      });
      return;
    }
    const id = `sem-${Date.now()}-${(idSeq.current += 1)}`;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        semesters: [...prev.semesters, { id, ...input }],
        coursesBySemester: {
          ...prev.coursesBySemester,
          [id]: copyFromId
            ? copyCoursesForSemester(prev.coursesBySemester[copyFromId] ?? [])
            : [],
        },
        homeworkBySemester: {
          ...prev.homeworkBySemester,
          [id]: [],
        },
      };
    });
    setSemesterId(id);
  };

  const handleDeleteSemester = (id: string) => {
    markDirty();
    const remaining = (data?.semesters ?? []).filter((item) => item.id !== id);
    setData((prev) => {
      if (!prev) return prev;
      const coursesBySemester = { ...prev.coursesBySemester };
      const homeworkBySemester = { ...prev.homeworkBySemester };
      delete coursesBySemester[id];
      delete homeworkBySemester[id];
      return {
        ...prev,
        semesters: prev.semesters.filter((item) => item.id !== id),
        coursesBySemester,
        homeworkBySemester,
      };
    });
    if (semesterId === id) {
      setSemesterId(remaining[0]?.id ?? "");
      setHomeworkCourseFilter("all");
      setSelectedCourse(null);
    }
  };

  const courseCounts = Object.fromEntries(
    (data?.semesters ?? []).map((item) => [
      item.id,
      (data?.coursesBySemester[item.id] ?? []).length,
    ]),
  );

  const pendingCount = homework.filter(
    (item) => item.status === "pending",
  ).length;
  const reminderCount = homework.filter(
    (item) =>
      item.status === "pending" &&
      (isOverdue(item, today) || isDueSoon(item.dueAt, leadDays, today)),
  ).length;

  const studyHeader = (
    <PageHeader
      title={t("pages.study.title")}
      description={t("pages.study.description")}
      actions={<PageHelpButton target="tasks.study" />}
    />
  );

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl">
        {studyHeader}
        <InlineNotice variant="error" className="mt-5">
          {loadError}
        </InlineNotice>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          {t("study.retry")}
        </Button>
      </div>
    );
  }

  if (!data || !semester) {
    return (
      <div className="mx-auto max-w-6xl">
        {studyHeader}
        <p className="mt-8 text-center text-sm text-muted">
          {t("study.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {studyHeader}

      {reminderEnabled && !reminderBannerHidden && reminderCount > 0 && (
        <Banner
          variant="warn"
          className="mt-4"
          onClose={() => setReminderBannerHidden(true)}
        >
          {t("study.reminderBanner", { count: reminderCount })}
        </Banner>
      )}

      <div className="mt-5">
        <SegmentedControl
          value={view}
          onChange={setView}
          size="md"
          variant="tabs"
          options={[
            {
              value: "schedule",
              label: t("study.viewSchedule"),
              icon: CalendarDays,
            },
            {
              value: "homework",
              label: t("study.viewHomework"),
              icon: ClipboardList,
              badge: pendingCount,
            },
          ]}
          equal
        />
      </div>

      {view === "schedule" ? (
        <CourseScheduleView
          courses={courses}
          homework={homework}
          semesters={data.semesters}
          semester={semester}
          onSemesterChange={handleSemesterChange}
          onManageSemesters={() => setSemesterManageOpen(true)}
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
          showAllWeeks={showAllWeeks}
          onShowAllWeeksChange={setShowAllWeeks}
          currentWeek={currentWeek}
          actualWeek={actualWeek}
          onWeekChange={handleWeekChange}
          onResetWeek={handleResetWeek}
          today={today}
          onAdd={() => {
            setEditingCourse(null);
            setCourseFormOpen(true);
          }}
          onOpenDetail={setSelectedCourse}
          onOpenCourseHomework={openCourseHomework}
        />
      ) : (
        <HomeworkView
          homework={homework}
          courses={courses}
          courseFilter={homeworkCourseFilter}
          onCourseFilterChange={setHomeworkCourseFilter}
          today={today}
          reminderEnabled={reminderEnabled}
          leadDays={leadDays}
          expandHomeworkId={expandedHomeworkId}
          onAdd={() => {
            setEditingHomework(null);
            setHomeworkFormOpen(true);
          }}
          onEdit={(item) => {
            setEditingHomework(item);
            setHomeworkFormOpen(true);
          }}
          onToggleStatus={toggleHomeworkStatus}
          onArchive={archiveHomework}
          onDelete={deleteHomework}
        />
      )}

      <CourseFormDialog
        open={courseFormOpen}
        initial={editingCourse}
        existingCourses={courses}
        existingColors={courses.map((course) => course.color)}
        onSave={saveCourse}
        onDelete={deleteCourse}
        onClose={() => setCourseFormOpen(false)}
      />
      <CourseDetailDialog
        open={selectedCourse !== null}
        course={selectedCourse}
        homework={
          selectedCourse
            ? homework.filter((item) => item.courseId === selectedCourse.id)
            : []
        }
        today={today}
        onEdit={() => {
          if (!selectedCourse) return;
          setEditingCourse(selectedCourse);
          setCourseFormOpen(true);
          setSelectedCourse(null);
        }}
        onDelete={deleteCourse}
        onSelectHomework={(homeworkId) => {
          if (!selectedCourse) return;
          openCourseHomework(selectedCourse.id, homeworkId);
          setSelectedCourse(null);
        }}
        onClose={() => setSelectedCourse(null)}
      />
      <HomeworkFormDialog
        open={homeworkFormOpen}
        initial={editingHomework}
        courses={courses}
        today={today}
        semesterStart={semester.startDate}
        onSave={saveHomework}
        onClose={() => setHomeworkFormOpen(false)}
      />
      <SemesterManageDialog
        open={semesterManageOpen}
        semesters={data.semesters}
        courseCounts={courseCounts}
        onSave={handleSaveSemester}
        onDelete={handleDeleteSemester}
        onClose={() => setSemesterManageOpen(false)}
      />
    </div>
  );
}
