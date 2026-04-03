import { ThreadType } from "zca-js";

export function getThreadType(input) {
  if (input === "user") return ThreadType.User;
  if (input === "group") return ThreadType.Group;
  return null;
}
