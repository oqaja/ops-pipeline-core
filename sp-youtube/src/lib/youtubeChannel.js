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

/** Ambil 1 halaman video dari uploads playlist (terbaru dulu). pageToken null = mulai dari awal (terbaru). */
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

module.exports = { getChannelInfo, listUploadsPage, getChannelStatistics };
