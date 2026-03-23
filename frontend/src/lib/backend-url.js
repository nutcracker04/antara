export function getBackendBaseUrl() {
  const rawUrl = process.env.REACT_APP_BACKEND_URL || "";
  return rawUrl.replace(/\/+$/, "");
}

export function getBackendApiUrl(path = "") {
  const baseUrl = getBackendBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
