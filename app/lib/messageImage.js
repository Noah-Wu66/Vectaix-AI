export const isHttpUrl = (src) => typeof src === "string" && /^https?:\/\//i.test(src);

export const isDataImageUrl = (src) => typeof src === "string" && /^data:image\//i.test(src);

export const isKeepableImageSrc = (src) => isHttpUrl(src) || isDataImageUrl(src);

export const getMessageImageSrc = (msg) => {
  if (Array.isArray(msg?.parts)) {
    for (const p of msg.parts) {
      const url = p?.inlineData?.url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
};

export const getMessageImageSrcs = (msg) => {
  if (!msg) return [];
  if (Array.isArray(msg.parts)) {
    const urls = [];
    for (const p of msg.parts) {
      const url = p?.inlineData?.url;
      if (typeof url === "string" && url) urls.push(url);
    }
    if (urls.length > 0) return urls;
  }
  return [];
};
