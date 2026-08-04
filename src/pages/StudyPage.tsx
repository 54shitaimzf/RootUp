import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ClipboardList } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { CourseDetailDialog } from "../features/study/CourseDetailDialog";
import { CourseFormDialog } from "../features/study/CourseFormDialog";
import { CourseScheduleView } from "../features/study/CourseScheduleView";
import { HomeworkFormDialog } from "../features/study/HomeworkFormDialog";
import { HomeworkView } from "../features/study/HomeworkView";
import {
  DEMO_SEMESTERS,
  DEMO_COURSES,
  DEMO_HOMEWORK,
  clampWeek,
  weekNumberFromDate,
  type Course,
  type CourseDraft,
  type Homework,
  type HomeworkDraft,
  type StudyView,
  type WeekStart,
} from "../lib/study";

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
        typeof parsed.semesterId === "string" &&
        DEMO_SEMESTERS.some((item) => item.id === parsed.semesterId)
          ? parsed.semesterId
          : DEMO_SEMESTERS[0].id,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 学业页：课程表 + 作业；数据仅存前端内存，偏好记忆用 localStorage。*/
export function StudyPage({ today = new Date() }: { today?: Date }) {
  const { t } = useTranslation();
  const [prefs] = useState(loadPrefs);
  const [view, setView] = useState<StudyView>(prefs.view);
  const [courses, setCourses] = useState<Course[]>(DEMO_COURSES);
  const [homework, setHomework] = useState<Homework[]>(DEMO_HOMEWORK);
  const [weekStart, setWeekStart] = useState<WeekStart>(prefs.weekStart);
  const [showAllWeeks, setShowAllWeeks] = useState(prefs.showAllWeeks);
  const [semesterId, setSemesterId] = useState(prefs.semesterId);
  const [weekOverride, setWeekOverride] = useState<number | null>(null);
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

  useEffect(() => {
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({ view, weekStart, showAllWeeks, semesterId }),
      );
    } catch {
      // 读取或写入失败时静默回退默认，不阻塞页面
    }
  }, [view, weekStart, showAllWeeks, semesterId]);

  const nextId = (prefix: string) =>
    `${prefix}-${Date.now()}-${(idSeq.current += 1)}`;

  const semester =
    DEMO_SEMESTERS.find((item) => item.id === semesterId) ??
    DEMO_SEMESTERS[0];
  const actualWeek = weekNumberFromDate(semester.startDate, today);
  const currentWeek = clampWeek(weekOverride ?? actualWeek, semester.weekCount);

  const saveCourse = (draft: CourseDraft) => {
    if (editingCourse) {
      setCourses((prev) =>
        prev.map((course) =>
          course.id === editingCourse.id ? { ...course, ...draft } : course,
        ),
      );
    } else {
      setCourses((prev) => [...prev, { ...draft, id: nextId("c") }]);
    }
  };

  const deleteCourse = (id: string) => {
    setCourses((prev) => prev.filter((course) => course.id !== id));
    setHomework((prev) =>
      prev.map((item) =>
        item.courseId === id ? { ...item, courseId: null } : item,
      ),
    );
    setHomeworkCourseFilter((prev) => (prev === id ? "all" : prev));
    setSelectedCourse((prev) => (prev?.id === id ? null : prev));
  };

  const saveHomework = (draft: HomeworkDraft) => {
    if (editingHomework) {
      setHomework((prev) =>
        prev.map((item) =>
          item.id === editingHomework.id ? { ...item, ...draft } : item,
        ),
      );
    } else {
      setHomework((prev) => [...prev, { ...draft, id: nextId("h") }]);
    }
  };

  const toggleHomeworkStatus = (id: string) => {
    setHomework((prev) =>
      prev.map((item) => {
        if (item.id !== id || item.status === "archived") return item;
        return {
          ...item,
          status: item.status === "pending" ? "done" : "pending",
        };
      }),
    );
  };

  const archiveHomework = (id: string) => {
    setHomework((prev) =>
      prev.map((item) =>
        item.id === id && item.status === "done"
          ? { ...item, status: "archived" }
          : item,
      ),
    );
  };

  const deleteHomework = (id: string) => {
    setHomework((prev) => prev.filter((item) => item.id !== id));
  };

  const openCourseHomework = (courseId: string, homeworkId?: string) => {
    setHomeworkCourseFilter(courseId);
    setView("homework");
    setExpandedHomeworkId(homeworkId ?? null);
  };

  const pendingCount = homework.filter(
    (item) => item.status === "pending",
  ).length;

  const handleSemesterChange = (id: string) => {
    setSemesterId(id);
    setWeekOverride(null);
  };

  const handleWeekChange = (week: number) => {
    setWeekOverride(clampWeek(week, semester.weekCount));
  };

  const handleResetWeek = () => setWeekOverride(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("pages.study.title")}
        description={t("pages.study.description")}
      />

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
          semesters={DEMO_SEMESTERS}
          semester={semester}
          onSemesterChange={handleSemesterChange}
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
    </div>
  );
}
