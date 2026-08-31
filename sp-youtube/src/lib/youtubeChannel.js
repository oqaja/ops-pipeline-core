let cachedUploadsPlaylistId = null;
let cachedChannelId = null;

async function getChannelInfo(youtube) {
  if (cachedUploadsPlaylistId && cachedChannelId) {
    return { uploadsPlaylistId: cachedUploadsPlaylistId, channelId: cachedChannelId };
  }
  const res = await youtube.channels.list({ part: ["contentDetails", "id"], mine: true });
  const channel = res.data.items && res.data.items[0];
  if (!channel) throw new Error("Channel tidak ditemukan (cek OAuth akun yang login).");
  cachedUploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
  cachedChannelId = channel.id;
  return { uploadsPlaylistId: cachedUploadsPlaylistId, channelId: cachedChannelId };
}

async function listUploadsPage(youtube, uploadsPlaylistId, pageToken, maxResults = 50) {
  const res = await youtube.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId: uploadsPlaylistId,
    maxResults,
    pageToken: pageToken || undefined,
  });
  const items = (res.data.items || []).map((item) => ({
    videoId: item.contentDetails.videoId,
    title: item.snippet.title,
    publishedAt: item.contentDetails.videoPublishedAt,
  }));
  return { items, nextPageToken: res.data.nextPageToken || null };
}

async function getChannelStatistics(youtube) {
  const res = await youtube.channels.list({ part: ["statistics", "snippet"], mine: true });
  const channel = res.data.items && res.data.items[0];
  if (!channel) throw new Error("Channel tidak ditemukan.");
  return {
    title: channel.snippet.title,
    subscriberCount: channel.statistics.subscriberCount,
    viewCount: channel.statistics.viewCount,
    videoCount: channel.statistics.videoCount,
  };
}

function parseISO8601Duration(iso) {
  const match = (iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Ambil durasi untuk sampai 50 video ID sekaligus. */
async function getVideoDetails(youtube, videoIds) {
  if (videoIds.length === 0) return {};

  const res = await youtube.videos.list({
    part: ["contentDetails"],
    id: videoIds,
  });

  const map = {};
  for (const item of res.data.items || []) {
    map[item.id] = { durationSeconds: parseISO8601Duration(item.contentDetails.duration) };
  }
  return map;
}

module.exports = { getChannelInfo, listUploadsPage, getChannelStatistics, getVideoDetails, parseISO8601Duration };
