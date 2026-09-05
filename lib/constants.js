/**
 * PikPak Video Streamer Constants
 * Reverse-engineered web client configurations and endpoints
 */
(function (root) {
  const constants = {
    WEB_CLIENT_ID: "YUMx5nI8ZU8Ap8pm",
    WEB_CLIENT_VERSION: "2.0.0",
    WEB_PACKAGE_NAME: "mypikpak.com",
    WEB_ALGORITHMS: [
      "C9qPpZLN8ucRTaTiUMWYS9cQvWOE",
      "+r6CQVxjzJV6LCV",
      "F",
      "pFJRC",
      "9WXYIDGrwTCz2OiVlgZa90qpECPD6olt",
      "/750aCr4lm/Sly/c",
      "RB+DT/gZCrbV",
      "",
      "CyLsf7hdkIRxRm215hl",
      "7xHvLi2tOYP0Y92b",
      "ZGTXXxu8E/MIWaEDB+Sm/",
      "1UI3",
      "E7fP5Pfijd+7K+t6Tg/NhuLq0eEUVChpJSkrKxpO",
      "ihtqpG6FMt65+Xk+tWUH2",
      "NhXXU9rg4XXdzo7u5o",
    ],

    // Official Android App Client configuration (bypasses Web preview limits and 416 Range restriction)
    ANDROID_CLIENT_ID: "YNxT9w7GMdWvEOKa",
    ANDROID_CLIENT_VERSION: "1.53.2",
    ANDROID_PACKAGE_NAME: "com.pikcloud.pikpak",
    ANDROID_ALGORITHMS: [
      "SOP04dGzk0TNO7t7t9ekDbAmx+eq0OI1ovEx",
      "nVBjhYiND4hZ2NCGyV5beamIr7k6ifAsAbl",
      "Ddjpt5B/Cit6EDq2a6cXgxY9lkEIOw4yC1GDF28KrA",
      "VVCogcmSNIVvgV6U+AochorydiSymi68YVNGiz",
      "u5ujk5sM62gpJOsB/1Gu/zsfgfZO",
      "dXYIiBOAHZgzSruaQ2Nhrqc2im",
      "z5jUTBSIpBN9g4qSJGlidNAutX6",
      "KJE2oveZ34du/g1tiimm",
    ],
    ANDROID_UA: "PikPak/1.53.2 (Linux; U; Android 14; M2004j7ac; Build/UKQ1.231108.001)",
    API_HOSTS: [
      "api-drive.mypikpak.net",
      "api-drive.mypikpak.com"
    ],
    USER_HOSTS: [
      "user.mypikpak.net",
      "user.mypikpak.com"
    ],
    DEFAULT_UA:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    
    VIDEO_EXTENSIONS: [
      ".mp4", ".mkv", ".mov", ".avi", ".flv", ".webm", ".ts", ".m4v", ".wmv", ".3gp"
    ],
    IMAGE_EXTENSIONS: [
      ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".avif", ".heic", ".tiff"
    ],
    
    // Default TTL for cached streaming URLs (3 hours in ms)
    URL_CACHE_TTL: 3 * 60 * 60 * 1000
  };

  root.PikPakConstants = constants;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = constants;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
