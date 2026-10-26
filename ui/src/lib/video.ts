// Video pages: sites where an address is almost always a video page (the Add dialog looks for the video right away),
// and durations for display. Any other web page can still be searched for a video on request.
const VIDEO_SITES =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|reddit\.com|soundcloud\.com|bilibili\.com|aparat\.com|rumble\.com|streamable\.com|ted\.com|bandcamp\.com|mixcloud\.com|ok\.ru|vk\.com|nicovideo\.jp)$/i;

export function isVideoSite(url: string): boolean {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && VIDEO_SITES.test(u.hostname);
  } catch {
    return false;
  }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
