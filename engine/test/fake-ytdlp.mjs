// A stand-in for yt-dlp in the video tests: answers -J with a fixed set of formats, and "downloads" by printing
// progress in Grabbit's template (two tracks, then a merge) and writing a file. Addresses steer it: "novideo" has no
// video, "fail" breaks mid-way, "slow" takes a few seconds. Each run's arguments are appended to FAKE_YTDLP_LOG.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args[args.length - 1];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (process.env.FAKE_YTDLP_LOG) fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (url.includes('novideo')) {
  process.stderr.write(`ERROR: [generic] Unsupported URL: ${url}\n`);
  process.exit(1);
}

if (args.includes('-J')) {
  process.stdout.write(
    JSON.stringify({
      title: 'Test Clip: "one"/two',
      extractor_key: 'Youtube',
      thumbnail: 'https://i.example/t.jpg',
      duration: 10,
      formats: [
        { format_id: '137', ext: 'mp4', height: 1080, vcodec: 'avc1', acodec: 'none', filesize: 3_000_000 },
        { format_id: '136', ext: 'mp4', height: 720, vcodec: 'avc1', acodec: 'none', filesize: 1_500_000 },
        { format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a', filesize_approx: 800_000 },
        { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', filesize: 500_000 },
      ],
    }),
  );
  process.exit(0);
}

const slow = url.includes('slow');
const tracks = opt('-f').includes('+') ? [60_000, 20_000] : [80_000];
for (const [t, total] of tracks.entries()) {
  for (let got = 0; got <= total; got += total / 5) {
    process.stdout.write(`GRABBIT-P ${got} ${total} NA\n`);
    if (url.includes('fail') && t === 0 && got > 0) {
      process.stderr.write('ERROR: [youtube] abc123: Video unavailable. This video is private\n');
      process.exit(1);
    }
    await sleep(slow ? 500 : 30);
  }
}
const file = path.join(opt('-P'), opt('-o').replace('%(ext)s', 'mp4').replace(/%%/g, '%'));
if (tracks.length > 1) process.stdout.write(`[Merger] Merging formats into "${file}"\n`);
fs.writeFileSync(file, Buffer.alloc(tracks.reduce((a, b) => a + b, 0), 7));
process.stdout.write(`GRABBIT-F ${file}\n`);
