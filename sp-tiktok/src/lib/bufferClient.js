const { CONFIG, getBufferApiKey } = require("./config");

async function kirimCreatePostKeBuffer(captionText, judulSheet, assetsGraphQL, dueAtIso, isPhotoPost) {
  const apiKey = getBufferApiKey();
  const metadataBlock = isPhotoPost
    ? `metadata: { tiktok: { title: ${JSON.stringify(judulSheet)} } }`
    : "";

  const mutation = `
    mutation {
      createPost(
        input: {
          text: ${JSON.stringify(captionText)}
          channelId: "${CONFIG.BUFFER_CHANNEL_ID}"
          schedulingType: automatic
          mode: customScheduled
          dueAt: "${dueAtIso}"
          assets: [ ${assetsGraphQL} ]
          ${metadataBlock}
        }
      ) {
        ... on PostActionSuccess {
          post { id status dueAt }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ query: mutation }),
  });
  return response.json();
}

async function cekStatusPost(bufferPostId) {
  const apiKey = getBufferApiKey();
  const query = `
    query {
      post(input: { id: "${bufferPostId}" }) {
        status
        externalLink
        error { message }
      }
    }
  `;
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ query }),
  });
  return response.json();
}

module.exports = { kirimCreatePostKeBuffer, cekStatusPost };
