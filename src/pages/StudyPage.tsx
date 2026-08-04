import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { CourseFormDialog } from "../features/study/CourseFormDialog";
import { CourseScheduleView } from "../features/study/CourseScheduleView";
import { HomeworkFormDialog } from "../features/study/HomeworkFormDialog";
import { HomeworkView } from "../features/study/HomeworkView";
import {
  DEMO_COURSES,
  DEMO_HOMEWORK,
  DEMO_SEMESTER_START,
  weekNumberFromDate,
  type Course,
  type CourseDraft,
  type Homework,
  type HomeworkDraft,
  type StudyView,
  type WeekStart,
} from "../lib/study";

/**
 * 学业页（UI 第一版）：课程表 + 作业两个平级视图。
 * 数据仅存前端内存；下一轮按 lib/study.ts 的类型接后端持久化。
 */
export function StudyPage({ today = new Date() }: { today?: Date }) {
  const { t } = useTranslation();
  const [view, setView] = useState<StudyView>("schedule");
  const [courses, setCourses] = useState<Course[]>(DEMO_COURSES);
  const [homework, setHomework] = useState<Homework[]>(DEMO_HOMEWORK);
  const [weekStart, setWeekStart] = useState<WeekStart>("monday");
  const [showAllWeeks, setShowAllWeeks] = useState(true);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [homeworkFormOpen, setHomeworkFormOpen] = useState(false);
  const [editingHomework, setEditingHomework] = useState<Homework | null>(null);
  const [homeworkCourseFilter, setHomeworkCourseFilter] = useState<
    "all" | "none" | string
  >("all");
  const idSeq = useRef(0);

  const nextId = (prefix: string) =>
    `${prefix}-${Date.now()}-${(idSeq.current += 1)}`;

  const currentWeek = weekNumberFromDate(DEMO_SEMESTER_START, today);

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

  const openCourseHomework = (courseId: string) => {
    setHomeworkCourseFilter(courseId);
    setView("homework");
  };

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
            { value: "schedule", label: t("study.viewSchedule") },
            { value: "homework", label: t("study.viewHomework") },
          ]}
        />
      </div>

      {view === "schedule" ? (
        <CourseScheduleView
          courses={courses}
          homework={homework}
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
          showAllWeeks={showAllWeeks}
          onShowAllWeeksChange={setShowAllWeeks}
          currentWeek={currentWeek}
          today={today}
          onAdd={() => {
            setEditingCourse(null);
            setCourseFormOpen(true);
          }}
          onEdit={(course) => {
            setEditingCourse(course);
            setCourseFormOpen(true);
          }}
          onOpenCourseHomework={openCourseHomework}
        />
      ) : (
        <HomeworkView
          homework={homework}
          courses={courses}
          courseFilter={homeworkCourseFilter}
          onCourseFilterChange={setHomeworkCourseFilter}
          today={today}
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
        existingColors={courses.map((course) => course.color)}
        onSave={saveCourse}
        onDelete={deleteCourse}
        onClose={() => setCourseFormOpen(false)}
      />
      <HomeworkFormDialog
        open={homeworkFormOpen}
        initial={editingHomework}
        courses={courses}
        onSave={saveHomework}
        onClose={() => setHomeworkFormOpen(false)}
      />
    </div>
  );
}
