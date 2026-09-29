import { reorderProject } from "./projectOrder";

const projects = [
  { id: "a", folderId: "folder" },
  { id: "other", folderId: "elsewhere" },
  { id: "b", folderId: "folder" },
  { id: "c", folderId: "folder" },
];
const inFolder = (items) => items.filter((p) => p.folderId === "folder").map((p) => p.id);

test("moves projects up and down within a folder without changing other projects", () => {
  expect(inFolder(reorderProject(projects, "c", "a", "before"))).toEqual(["c", "a", "b"]);
  const moved = reorderProject(projects, "a", "c", "after");
  expect(inFolder(moved)).toEqual(["b", "c", "a"]);
  expect(moved.find((p) => p.id === "other")).toBe(projects[1]);
  expect(inFolder(projects)).toEqual(["a", "b", "c"]);
  expect(inFolder(JSON.parse(JSON.stringify(moved)))).toEqual(["b", "c", "a"]);
});

test("drops into another folder at the target position", () => {
  const moved = reorderProject(projects, "other", "b", "after");
  expect(inFolder(moved)).toEqual(["a", "b", "other", "c"]);
});

test("ignores self drops and missing projects", () => {
  expect(reorderProject(projects, "a", "a")).toBe(projects);
  expect(reorderProject(projects, "missing", "a")).toBe(projects);
  expect(reorderProject(projects, "a", "missing")).toBe(projects);
});
