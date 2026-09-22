import { getTimezoneOffsetString } from "../core/chart-utils.ts";

export interface TimezoneOption {
  id: string;
  title: string;
}

export interface ResolvedTimezoneOption extends TimezoneOption {
  offset: string;
  offsetMinutes: number;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { id: "Etc/UTC", title: "UTC" },
  { id: "exchange", title: "Sở giao dịch" },
  { id: "Pacific/Honolulu", title: "Honolulu" },
  { id: "Pacific/Gambier", title: "Gambier" },
  { id: "America/Juneau", title: "Juneau" },
  { id: "America/Los_Angeles", title: "Los Angeles" },
  { id: "America/Phoenix", title: "Phoenix" },
  { id: "America/Vancouver", title: "Vancouver" },
  { id: "America/Denver", title: "Denver" },
  { id: "America/El_Salvador", title: "San Salvador" },
  { id: "America/Mexico_City", title: "Thành phố Mexico" },
  { id: "America/Bogota", title: "Bogota" },
  { id: "America/Chicago", title: "Chicago" },
  { id: "America/Lima", title: "Lima" },
  { id: "America/Caracas", title: "Caracas" },
  { id: "America/New_York", title: "New York" },
  { id: "America/Toronto", title: "Toronto" },
  { id: "America/Argentina/Buenos_Aires", title: "Buenos Aires" },
  { id: "America/Santiago", title: "Santiago" },
  { id: "America/Sao_Paulo", title: "Sao Paulo" },
  { id: "Atlantic/Reykjavik", title: "Reykjavik" },
  { id: "Africa/Casablanca", title: "Casablanca" },
  { id: "Europe/Dublin", title: "Dublin" },
  { id: "Europe/Lisbon", title: "Lisbon" },
  { id: "Europe/London", title: "Luân Đôn" },
  { id: "Europe/Amsterdam", title: "Amsterdam" },
  { id: "Europe/Belgrade", title: "Belgrade" },
  { id: "Europe/Berlin", title: "Berlin" },
  { id: "Europe/Bratislava", title: "Bratislava" },
  { id: "Europe/Brussels", title: "Brussels" },
  { id: "Europe/Budapest", title: "Budapest" },
  { id: "Europe/Copenhagen", title: "Copenhagen" },
  { id: "Europe/Luxembourg", title: "Luxembourg" },
  { id: "Europe/Madrid", title: "Madrid" },
  { id: "Europe/Malta", title: "Malta" },
  { id: "Europe/Oslo", title: "Oslo" },
  { id: "Europe/Paris", title: "Paris" },
  { id: "Europe/Prague", title: "Prague" },
  { id: "Europe/Rome", title: "Rome" },
  { id: "Europe/Stockholm", title: "Stockholm" },
  { id: "Europe/Vienna", title: "Vienna" },
  { id: "Europe/Warsaw", title: "Warsaw" },
  { id: "Europe/Zurich", title: "Zurich" },
  { id: "Europe/Athens", title: "Athens" },
  { id: "Europe/Bucharest", title: "Bucharest" },
  { id: "Europe/Helsinki", title: "Helsinki" },
  { id: "Europe/Istanbul", title: "Istanbul" },
  { id: "Europe/Riga", title: "Riga" },
  { id: "Europe/Tallinn", title: "Tallinn" },
  { id: "Europe/Vilnius", title: "Vilnius" },
  { id: "Africa/Cairo", title: "Cairo" },
  { id: "Africa/Johannesburg", title: "Johannesburg" },
  { id: "Europe/Moscow", title: "Moscow" },
  { id: "Asia/Bahrain", title: "Bahrain" },
  { id: "Asia/Kuwait", title: "Kuwait" },
  { id: "Asia/Qatar", title: "Qatar" },
  { id: "Asia/Riyadh", title: "Riyadh" },
  { id: "Asia/Tehran", title: "Tehran" },
  { id: "Asia/Dubai", title: "Dubai" },
  { id: "Asia/Muscat", title: "Muscat" },
  { id: "Asia/Ashgabat", title: "Ashgabat" },
  { id: "Asia/Karachi", title: "Karachi" },
  { id: "Asia/Kolkata", title: "Kolkata" },
  { id: "Asia/Colombo", title: "Colombo" },
  { id: "Asia/Kathmandu", title: "Kathmandu" },
  { id: "Asia/Dhaka", title: "Dhaka" },
  { id: "Asia/Yangon", title: "Yangon" },
  { id: "Asia/Bangkok", title: "Bangkok, Hà Nội, Jakarta" },
  { id: "Asia/Ho_Chi_Minh", title: "Thành phố Hồ Chí Minh" },
  { id: "Asia/Hong_Kong", title: "Hồng Kông" },
  { id: "Asia/Manila", title: "Manila" },
  { id: "Asia/Shanghai", title: "Shanghai" },
  { id: "Asia/Singapore", title: "Singapore" },
  { id: "Asia/Taipei", title: "Taipei" },
  { id: "Asia/Tokyo", title: "Tokyo" },
  { id: "Asia/Seoul", title: "Seoul" },
  { id: "Australia/Perth", title: "Perth" },
  { id: "Australia/Adelaide", title: "Adelaide" },
  { id: "Australia/Brisbane", title: "Brisbane" },
  { id: "Australia/Sydney", title: "Sydney" },
  { id: "Pacific/Norfolk", title: "Norfolk" },
  { id: "Pacific/Auckland", title: "Auckland" },
  { id: "Pacific/Chatham", title: "Chatham" },
];

export function sortedTimezoneOptions(
  date = new Date(),
  exchangeTimezone = "Asia/Bangkok",
): ResolvedTimezoneOption[] {
  const resolved = TIMEZONE_OPTIONS.map((option) => {
    const zone = option.id === "exchange" ? exchangeTimezone : option.id;
    const { offsetMinutes, string } = getTimezoneOffsetString(zone, date);
    return { ...option, offset: string, offsetMinutes };
  });
  const pinned = resolved.slice(0, 2);
  const zones = resolved.slice(2).sort((left, right) =>
    left.offsetMinutes - right.offsetMinutes || left.title.localeCompare(right.title, "vi"),
  );
  return [...pinned, ...zones];
}
