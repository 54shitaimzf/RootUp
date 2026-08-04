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
import { SemesterManageDialog } from "../features/study/SemesterManageDialog";
import {
  clampWeek,
  weekNumberFromDate,
  type Course,
  type CourseDraft,
  type Homework,
  type HomeworkDraft,
  type StudyView,
  type WeekStart,
} from "../lib/study";
import {
  copyCoursesForSemester,
  loadStudyData,
  saveStudyData,
  type StudyDataV1,
} from "../lib/studyStore";

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

/** 学业页：学期即课表，数据持久化到 localStorage，偏好记忆用同一存储区。*/
export function StudyPage({ today = new Date() }: { today?: Date }) {
  const { t } = useTranslation();
  const [prefs] = useState(loadPrefs);
  const [data, setData] = useState<StudyDataV1>(loadStudyData);
  const [view, setView] = useState<StudyView>(prefs.view);
  const [weekStart, setWeekStart] = useState<WeekStart>(prefs.weekStart);
  const [showAllWeeks, setShowAllWeeks] = useState(prefs.showAllWeeks);
  const [semesterId, setSemesterId] = useState<string>(() => {
    const saved = prefs.semesterId;
    return saved && data.semesters.some((item) => item.id === saved)
      ? saved
      : (data.semesters[0]?.id ?? "");
  });
  const [weekOverride, setWeekOverride] = useState<number | null>(null);
  const [semesterManageOpen, setSemesterManageOpen] = useState(false);
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
    saveStudyData(data);
  }, [data]);

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

  const semester =
    data.semesters.find((item) => item.id === semesterId) ??
    data.semesters[0];
  const courses = data.coursesBySemester[semester?.id ?? ""] ?? [];
  const homework = data.homeworkBySemester[semester?.id ?? ""] ?? [];
  const actualWeek = semester
    ? weekNumberFromDate(semester.startDate, today)
    : 1;
  const currentWeek = semester
    ? clampWeek(weekOverride ?? actualWeek, semester.weekCount)
    : 1;

  const nextId = (prefix: string) =>
    `${prefix}-${Date.now()}-${(idSeq.current += 1)}`;

  const updateCourses = (updater: (list: Course[]) => Course[]) => {
    setData((prev) => {
      const id = semester?.id ?? "";
      const list = prev.coursesBySemester[id] ?? [];
      return {
        ...prev,
        coursesBySemester: {
          ...prev.coursesBySemester,
          [id]: updater(list),
        },
      };
    });
  };

  const updateHomework = (updater: (list: Homework[]) => Homework[]) => {
    setData((prev) => {
      const id = semester?.id ?? "";
      const list = prev.homeworkBySemester[id] ?? [];
      return {
        ...prev,
        homeworkBySemester: {
          ...prev.homeworkBySemester,
          [id]: updater(list),
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
    if (editingId) {
      setData((prev) => ({
        ...prev,
        semesters: prev.semesters.map((item) =>
          item.id === editingId ? { ...item, ...input } : item,
        ),
      }));
      return;
    }
    const id = `sem-${Date.now()}-${(idSeq.current += 1)}`;
    setData((prev) => ({
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
    }));
    setSemesterId(id);
  };

  const handleDeleteSemester = (id: string) => {
    const remaining = data.semesters.filter((item) => item.id !== id);
    setData((prev) => {
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
    data.semesters.map((item) => [
      item.id,
      (data.coursesBySemester[item.id] ?? []).length,
    ]),
  );

  const pendingCount = homework.filter(
    (item) => item.status === "pending",
  ).length;

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
        semesterStart={semester?.startDate}
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
