import { gt } from "../../l10n/l10n";

export function calendarColors(): { name: string, color: string }[] {
  return [
    { name: gt`Blue *=> Name of a color`, color: "#3B7DD8" },
    { name: gt`Green *=> Name of a color`, color: "#4CA45C" },
    { name: gt`Purple *=> Name of a color`, color: "#8A68BD" },
    { name: gt`Red *=> Name of a color`, color: "#D2504C" },
    { name: gt`Gray *=> Name of a color`, color: "#7D7D7D" },
    { name: gt`Yellow *=> Name of a color`, color: "#D6B02E" },
    { name: gt`Teal *=> Name of a color`, color: "#2B9C9C" },
    { name: gt`Orange *=> Name of a color`, color: "#DF7A36" },
    { name: gt`Pink *=> Name of a color`, color: "#CF6AA4" },
    { name: gt`Brown *=> Name of a color`, color: "#9B6A4D" },
    { name: gt`Light Blue`, color: "#7DB4E5" },
    { name: gt`Light Green`, color: "#8CC78E" },
    { name: gt`Lavender *=> Name of a color`, color: "#B49FDA" },
    { name: gt`Salmon *=> Name of a color`, color: "#EE8C82" },
    { name: gt`Olive *=> Name of a color`, color: "#909B3E" },
  ];
}
