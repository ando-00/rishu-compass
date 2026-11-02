import type { Course } from "../../../engine/model";

function numbered(prefix: string, count: number, assignedYear: number, group: string): Course[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${String(i + 1).padStart(2, "0")}`,
    credits: 2,
    assignedYear,
    groups: [group],
  }));
}

// 見本の科目。値はすべて説明用で、どの要項の内容でもない。
export const exampleCourses: Course[] = [
  { name: "入門A", credits: 2, assignedYear: 1, groups: ["基礎/必修"] },
  { name: "入門B", credits: 2, assignedYear: 1, groups: ["基礎/必修"] },
  { name: "基礎C", credits: 2, assignedYear: 1, groups: ["基礎/必修"] },
  { name: "基礎D", credits: 2, assignedYear: 1, groups: ["基礎/必修"] },
  { name: "基礎E", credits: 2, assignedYear: 1, groups: ["基礎/必修"] },
  { name: "応用B", credits: 2, assignedYear: 2, groups: ["甲専攻/選択"] },
  { name: "応用C", credits: 2, assignedYear: 2, groups: ["甲専攻/選択"] },
  {
    name: "ゼミ",
    credits: 4,
    assignedYear: 3,
    groups: ["甲専攻/選択", "演習"],
    offeredIn: "通年",
  },
  {
    name: "実習",
    credits: 2,
    assignedYear: 2,
    groups: ["甲専攻/選択", "演習"],
    offeredIn: "前期",
    slots: [{ day: "月", period: 1 }],
  },
  {
    name: "講読",
    credits: 2,
    assignedYear: 2,
    groups: ["甲専攻/選択"],
    offeredIn: "前期",
    slots: [{ day: "月", period: 1 }],
  },
  { name: "集中", credits: 2, assignedYear: 2, groups: ["甲専攻/選択"], intensive: true },
  ...numbered("専門", 20, 2, "甲専攻/選択"),
  ...numbered("乙", 8, 2, "乙専攻/選択"),
  ...numbered("他", 6, 2, "他学部"),
];
