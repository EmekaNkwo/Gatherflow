import type { GroupSchedule } from "@/types/group";

/** When a group meets, said the way a person would: "Every other Thursday at 18:30". */
export function meetsLabel(schedule: GroupSchedule): string {
  const day = schedule.weekday.charAt(0).toUpperCase() + schedule.weekday.slice(1);
  switch (schedule.frequency) {
    case "fortnightly":
      return `Every other ${day} at ${schedule.time}`;
    case "monthly":
      return `Once a month, on a ${day} at ${schedule.time}`;
    default:
      return `Every ${day} at ${schedule.time}`;
  }
}
